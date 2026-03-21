function asTime(value) {
  const n = new Date(value).getTime();
  return Number.isFinite(n) ? n : null;
}

function minutes(ms) {
  return Math.round(ms / 60000);
}

function pickMessage(line) {
  const msg1 = line?.['1'];
  const msg0 = line?.['0'];
  if (typeof msg1 === 'string' && msg1) return msg1;
  if (typeof msg0 === 'string' && msg0) return msg0;
  return '';
}

export function scanLogEvents(deltaText) {
  const lines = String(deltaText ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const events = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      const ts = asTime(parsed?.time ?? parsed?._meta?.date);
      const message = pickMessage(parsed);
      const lower = message.toLowerCase();
      const types = [];

      if (/feishu\[main\].*(received message|dispatch complete|starting websocket connection|websocket client started|bot open_id resolved|starting feishu\[main\])/.test(lower)) {
        types.push('feishu_success');
      }
      if (/feishu\[main\].*dispatching to agent/.test(lower)) {
        types.push('feishu_dispatch');
      }
      if (/feishu\[main\].*abort signal received/.test(lower)) {
        types.push('feishu_abort');
      }
      if (/99991672|im:resource(?::upload)?|dispatch failed|send failed|upload .* failed/.test(lower)) {
        types.push('feishu_error_delivery');
      }
      if (/config change requires gateway restart .* deferring until/.test(lower)) {
        types.push('restart_deferral');
      }
      if (/config\.patch write/.test(lower)) {
        types.push('config_patch');
      }
      let sessionKey = null;
      const scheduledMatch = message.match(/scheduled auto-resume for\s+([^\s]+)/i);
      if (scheduledMatch?.[1]) {
        sessionKey = scheduledMatch[1].trim();
        types.push('auto_resume_scheduled');
      }
      if (/auto-resume-lite|auto resume/.test(lower)) {
        types.push('auto_resume');
      }

      if (types.length > 0) {
        events.push({ ts, message, types, sessionKey, raw: parsed });
      }
    } catch {
      // ignore non-json log lines
    }
  }
  return events;
}

function groupEventStats(events) {
  const byType = new Map();
  for (const event of events) {
    for (const type of event.types) {
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type).push(event);
    }
  }
  return byType;
}

function hasCooldown(state, key, nowMs) {
  const until = state?.cooldowns?.[key] ?? 0;
  return until > nowMs;
}

function pushSignal(target, signal) {
  target.push(signal);
}

function pushIncident(target, incident) {
  target.push(incident);
}

function pushAction(target, action) {
  target.push(action);
}

function getRecentSessionAgeMs(statusJson, matcher) {
  const sessions = statusJson?.health?.sessions?.recent ?? statusJson?.sessions?.recent ?? [];
  const hits = sessions.filter((session) => matcher(String(session?.key ?? '')));
  if (hits.length === 0) return null;
  return Math.min(...hits.map((hit) => hit?.age).filter((age) => Number.isFinite(age)));
}

function buildFacts(snapshot, events) {
  const status = snapshot?.status?.json ?? {};
  const cfg = snapshot?.config?.projection ?? {};
  const health = status?.health ?? {};
  const feishuHealth = health?.channels?.feishu ?? {};
  const telegramHealth = health?.channels?.telegram ?? {};
  const stats = groupEventStats(events);

  const gatewayAuthLimited = String(status?.gateway?.error ?? '').includes('missing scope: operator.read');

  return {
    gatewayReachable: gatewayAuthLimited ? true : health?.channels ? status?.gateway?.reachable ?? health?.ok ?? null : null,
    telegram: {
      enabled: cfg?.channels?.telegram?.enabled === true,
      probeOk: telegramHealth?.probe?.ok ?? telegramHealth?.accounts?.default?.probe?.ok ?? null,
    },
    feishu: {
      enabled: cfg?.channels?.feishu?.enabled === true,
      rootConfigured: feishuHealth?.configured ?? null,
      mainConfigured: feishuHealth?.accounts?.main?.configured ?? null,
      mainProbeOk: feishuHealth?.accounts?.main?.probe?.ok ?? null,
      recentSuccessCount: stats.get('feishu_success')?.length ?? 0,
      recentErrorCount: stats.get('feishu_error_delivery')?.length ?? 0,
    },
    autoResumeLite: {
      enabled: cfg?.plugins?.autoResumeLite?.enabled === true,
      denySessionKeyPrefixes: cfg?.plugins?.autoResumeLite?.denySessionKeyPrefixes ?? [],
    },
    sessionAgesMs: {
      telegram: getRecentSessionAgeMs(status, (key) => key.includes(':telegram:')),
      feishu: getRecentSessionAgeMs(status, (key) => key.includes(':feishu:')),
    },
  };
}

function isHealthyEnough(snapshot, facts) {
  const status = snapshot?.status?.json;
  if (!status) return false;
  const telegramOk = facts?.telegram?.probeOk === true;
  const feishuSeemsOkay =
    facts?.feishu?.enabled === true &&
    (facts?.feishu?.mainConfigured === true || facts?.feishu?.mainProbeOk === true || facts?.feishu?.recentSuccessCount > 0);
  return telegramOk && feishuSeemsOkay;
}

export function analyzeSnapshot(snapshot, state = {}) {
  const nowMs = Date.now();
  const events = scanLogEvents(snapshot?.logs?.deltaText ?? '');
  const eventStats = groupEventStats(events);
  const facts = buildFacts(snapshot, events);
  const signals = [];
  const incidents = [];
  const actions = [];

  const statusJson = snapshot?.status?.json;
  const feishuEnabled = facts?.feishu?.enabled === true;
  const feishuRootFalse = facts?.feishu?.rootConfigured === false;
  const feishuMainTrue = facts?.feishu?.mainConfigured === true || facts?.feishu?.mainProbeOk === true;
  const feishuSuccessEvents = eventStats.get('feishu_success') ?? [];
  const feishuErrorEvents = eventStats.get('feishu_error_delivery') ?? [];
  const restartDeferrals = eventStats.get('restart_deferral') ?? [];
  const feishuAbortEvents = eventStats.get('feishu_abort') ?? [];
  const feishuDispatchEvents = eventStats.get('feishu_dispatch') ?? [];
  const autoResumeScheduledEvents = eventStats.get('auto_resume_scheduled') ?? [];
  const previousFeishuEnabled = state?.lastGood?.configProjection?.channels?.feishu?.enabled;
  const denyPrefixes = facts?.autoResumeLite?.denySessionKeyPrefixes ?? [];
  const quietWindowBreached =
    (facts?.sessionAgesMs?.telegram != null && facts.sessionAgesMs.telegram < 120000) ||
    (facts?.sessionAgesMs?.feishu != null && facts.sessionAgesMs.feishu < 120000);

  if (snapshot?.status?.parseError) {
    pushSignal(signals, {
      id: 'status_json_parse_failed',
      severity: 'warn',
      confidence: 'high',
      evidence: [snapshot.status.parseError],
    });
  }

  if (feishuEnabled && feishuRootFalse && (feishuMainTrue || feishuSuccessEvents.length > 0)) {
    pushSignal(signals, {
      id: 'feishu_status_path_mismatch',
      severity: 'warn',
      confidence: 'high',
      evidence: [
        `feishu root configured=false`,
        `feishu main configured/probe=${feishuMainTrue}`,
        `recent feishu success markers=${feishuSuccessEvents.length}`,
      ],
    });

    pushIncident(incidents, {
      id: 'feishu_status_path_mismatch',
      severity: 'warn',
      confidence: 'high',
      actionable: false,
      summary: 'Feishu looks alive at account/log level but one status path still says not configured.',
    });
  }

  if (feishuEnabled === false && previousFeishuEnabled === true) {
    pushSignal(signals, {
      id: 'feishu_config_drift_disable',
      severity: 'error',
      confidence: 'high',
      evidence: ['channels.feishu.enabled flipped away from a known-good true state'],
    });
    pushIncident(incidents, {
      id: 'feishu_config_drift_disable',
      severity: 'error',
      confidence: 'high',
      actionable: true,
      summary: 'Feishu appears drift-disabled relative to last known-good state.',
    });
    pushAction(actions, {
      id: 'manual_restore_feishu_config_branch',
      kind: 'manual-restore',
      priority: 'high',
      cooldownKey: 'manual_restore_feishu_config_branch',
      blockedByCooldown: hasCooldown(state, 'manual_restore_feishu_config_branch', nowMs),
      reason: 'Known-good Feishu config existed before; watcher should not auto-write config in v1.',
      command: 'Restore the relevant channels.feishu branch from the last known-good config snapshot, then run: openclaw gateway restart',
    });
  }

  if (feishuErrorEvents.length >= 1) {
    const lastError = feishuErrorEvents[feishuErrorEvents.length - 1];
    const laterSuccess = feishuSuccessEvents.some((event) => (event.ts ?? 0) > (lastError.ts ?? 0));

    pushSignal(signals, {
      id: 'fresh_delivery_errors_seen',
      severity: feishuErrorEvents.length >= 2 && !laterSuccess ? 'error' : 'warn',
      confidence: feishuErrorEvents.length >= 2 && !laterSuccess ? 'high' : 'medium',
      evidence: [
        `fresh delivery errors in current log delta=${feishuErrorEvents.length}`,
        `success after last error=${laterSuccess}`,
      ],
    });

    if (feishuErrorEvents.length >= 2 && !laterSuccess) {
      pushIncident(incidents, {
        id: 'repeated_delivery_failure_same_channel',
        severity: 'error',
        confidence: 'high',
        actionable: true,
        summary: 'Fresh repeated delivery failures were seen with no later recovery marker.',
      });

      pushAction(actions, {
        id: 'recommend_gateway_restart_for_delivery_path',
        kind: 'self-heal-plan',
        priority: quietWindowBreached ? 'defer' : 'high',
        cooldownKey: 'recommend_gateway_restart_for_delivery_path',
        blockedByCooldown: hasCooldown(state, 'recommend_gateway_restart_for_delivery_path', nowMs),
        reason: quietWindowBreached
          ? 'A recent active session exists; hold restart until the quiet window clears.'
          : 'Repeated delivery failure with no recovery marker and config still present.',
        command: 'openclaw gateway restart',
      });
    }
  }

  if (restartDeferrals.length > 0 && feishuAbortEvents.length > 0 && feishuDispatchEvents.length > 0) {
    const deferralTs = restartDeferrals[restartDeferrals.length - 1]?.ts ?? 0;
    const laterDispatch = feishuDispatchEvents.some((event) => (event.ts ?? 0) >= deferralTs);
    if (laterDispatch) {
      pushSignal(signals, {
        id: 'drain_race_restart_deferral',
        severity: 'warn',
        confidence: 'high',
        evidence: [
          `restart deferral markers=${restartDeferrals.length}`,
          `abort markers=${feishuAbortEvents.length}`,
          `later dispatch markers=${feishuDispatchEvents.length}`,
        ],
      });
      pushIncident(incidents, {
        id: 'drain_race_restart_deferral',
        severity: 'warn',
        confidence: 'high',
        actionable: true,
        summary: 'Restart/disable activity overlapped with in-flight channel work; hold disruptive actions briefly.',
      });
      pushAction(actions, {
        id: 'hold_restart_due_to_drain_race',
        kind: 'hold',
        priority: 'high',
        cooldownKey: 'hold_restart_due_to_drain_race',
        blockedByCooldown: hasCooldown(state, 'hold_restart_due_to_drain_race', nowMs),
        reason: 'Drain/in-flight race markers are present; do not auto-recommend another restart immediately.',
      });
    }
  }

  if (facts?.autoResumeLite?.enabled === true && !denyPrefixes.includes('agent:main:feishu:')) {
    pushSignal(signals, {
      id: 'auto_resume_feishu_risk',
      severity: 'warn',
      confidence: 'high',
      evidence: ['auto-resume-lite enabled without Feishu denySessionKeyPrefixes guard'],
    });
    pushIncident(incidents, {
      id: 'auto_resume_feishu_risk',
      severity: 'warn',
      confidence: 'high',
      actionable: true,
      summary: 'Auto-resume could still touch Feishu sessions.',
    });
    pushAction(actions, {
      id: 'manual_review_auto_resume_policy',
      kind: 'manual-review',
      priority: 'medium',
      cooldownKey: 'manual_review_auto_resume_policy',
      blockedByCooldown: hasCooldown(state, 'manual_review_auto_resume_policy', nowMs),
      reason: 'Watcher should not rewrite plugin policy in v1.',
    });
  }

  const conversationAutoResumes = autoResumeScheduledEvents.filter((event) => {
    const key = String(event.sessionKey ?? '');
    return key.includes(':telegram:direct:') || key.includes(':feishu:direct:');
  });
  if (conversationAutoResumes.length > 0) {
    pushSignal(signals, {
      id: 'auto_resume_conversation_noise',
      severity: 'warn',
      confidence: 'high',
      evidence: conversationAutoResumes.map((event) => event.sessionKey).slice(0, 5),
    });
    pushIncident(incidents, {
      id: 'auto_resume_conversation_noise',
      severity: 'warn',
      confidence: 'high',
      actionable: true,
      summary: 'Auto-resume was scheduled on a human-facing direct conversation session.',
    });
    pushAction(actions, {
      id: 'review_auto_resume_scope_for_direct_chats',
      kind: 'manual-review',
      priority: 'high',
      cooldownKey: 'review_auto_resume_scope_for_direct_chats',
      blockedByCooldown: hasCooldown(state, 'review_auto_resume_scope_for_direct_chats', nowMs),
      reason: 'Healthy direct conversations should not be nudged with repeated continue/recovery injections.',
    });
  }

  const telegramLooksDown = facts?.telegram?.enabled && facts?.telegram?.probeOk === false;
  const feishuLooksDown = feishuEnabled && !feishuMainTrue && feishuSuccessEvents.length === 0;
  if (telegramLooksDown && feishuLooksDown) {
    pushSignal(signals, {
      id: 'all_remote_paths_lost',
      severity: 'error',
      confidence: 'high',
      evidence: ['telegram not healthy', 'feishu not healthy', 'no fresh feishu success marker'],
    });
    pushIncident(incidents, {
      id: 'all_remote_paths_lost',
      severity: 'error',
      confidence: 'high',
      actionable: true,
      summary: 'No healthy remote-control channel remains.',
    });
    pushAction(actions, {
      id: 'escalate_agent_for_remote_recovery',
      kind: 'agent-escalation-plan',
      priority: 'highest',
      cooldownKey: 'escalate_agent_for_remote_recovery',
      blockedByCooldown: hasCooldown(state, 'escalate_agent_for_remote_recovery', nowMs),
      reason: 'Both remote-control paths appear unhealthy.',
    });
  }

  const preferredRecoveryChannel = facts?.telegram?.probeOk === true ? 'telegram' : feishuMainTrue ? 'feishu' : null;

  const nextState = {
    version: 1,
    updatedAt: new Date(nowMs).toISOString(),
    logCursors: snapshot?.logs?.cursor?.path
      ? {
          ...(state?.logCursors ?? {}),
          [snapshot.logs.cursor.path]: snapshot.logs.cursor,
        }
      : { ...(state?.logCursors ?? {}) },
    cooldowns: { ...(state?.cooldowns ?? {}) },
    lastReportMeta: {
      incidentCount: incidents.length,
      actionCount: actions.length,
      preferredRecoveryChannel,
    },
    lastGood: state?.lastGood ?? null,
  };

  for (const action of actions) {
    if (!action.blockedByCooldown && action.cooldownKey) {
      const ttl = action.kind === 'agent-escalation-plan' ? 60 * 60 * 1000 : 15 * 60 * 1000;
      nextState.cooldowns[action.cooldownKey] = nowMs + ttl;
    }
  }

  if (isHealthyEnough(snapshot, facts)) {
    nextState.lastGood = {
      seenAt: new Date(nowMs).toISOString(),
      configFingerprint: snapshot?.config?.fingerprint ?? null,
      configProjection: snapshot?.config?.projection ?? null,
      statusVersion: statusJson?.runtimeVersion ?? null,
    };
  }

  return {
    checkedAt: new Date(nowMs).toISOString(),
    facts: {
      ...facts,
      preferredRecoveryChannel,
      quietWindowBreached,
      healthyEnoughForLastGood: isHealthyEnough(snapshot, facts),
      freshLogEvents: events.length,
    },
    signals,
    incidents,
    proposedActions: actions,
    snapshotSummary: {
      configFingerprint: snapshot?.config?.fingerprint ?? null,
      logPath: snapshot?.logs?.latestPath ?? null,
      logBytesRead: snapshot?.logs?.bytesRead ?? 0,
      statusParseError: snapshot?.status?.parseError ?? null,
    },
    nextState,
    humanSummary: buildHumanSummary({ facts, signals, incidents, actions }),
  };
}

function buildHumanSummary({ facts, signals, incidents, actions }) {
  const parts = [];
  if (signals.find((s) => s.id === 'feishu_status_path_mismatch')) {
    parts.push('Feishu currently looks like a status-path mismatch, not a proven outage.');
  }
  if (incidents.find((i) => i.id === 'repeated_delivery_failure_same_channel')) {
    parts.push('Fresh repeated delivery failures were seen with no later recovery marker.');
  }
  if (incidents.find((i) => i.id === 'drain_race_restart_deferral')) {
    parts.push('Drain/in-flight race markers are active; disruptive actions should be held briefly.');
  }
  if (facts?.preferredRecoveryChannel) {
    parts.push(`Preferred recovery channel: ${facts.preferredRecoveryChannel}.`);
  }
  if (actions.length === 0) {
    parts.push('No disruptive action is recommended right now.');
  }
  return parts.join(' ');
}
