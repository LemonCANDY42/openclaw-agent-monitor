# auto-resume-lite patch evaluation (2026-03-21)

## Scope of this judgment

This evaluation is about the **current local patched copy** at:

- `tmp/openclaw-auto-resume-lite/index.js`

and specifically about whether the recent fixes make it:

1. safer for long-term unattended use,
2. closer to its intended behavior,
3. less likely to disrupt normal conversations,
4. less likely to inject noisy `continue / keep going` recoveries during healthy runs.

## Executive judgment

## Bottom line

**The patch is a meaningful improvement, and it clearly moves the plugin closer to its intended behavior.**

But:

**it is still not yet safe enough to trust broadly on human-facing direct-chat sessions without additional guardrails.**

My current judgment is:

- **For task-like/background sessions:** closer to acceptable.
- **For direct human conversations (Telegram/Feishu DM):** still too risky to enable broadly.
- **As a global unattended recovery plugin:** improved, but still only conditionally safe.

## Confidence

- High confidence that the patch fixed the previously observed Feishu-specific misbehavior path.
- Medium confidence that it is now broadly stable for general unattended use.
- Low-to-medium confidence that `non_action` is safe enough for normal conversations.

## What the patch definitely improved

### 1) `denySessionKeyPrefixes` is now actually enforced

This is a real and important fix.

Previously, Feishu sessions could still be touched even though policy intent existed. Now:

- config is parsed,
- prefixes are normalized,
- `isSessionKeyDenied()` exists,
- `maybeScheduleResume()` exits early for denied session keys.

**Effect:** this materially reduces the chance that the plugin re-enters protected session families such as:

- `agent:main:feishu:`

This is the single most important operational fix for the incident that happened.

### 2) `non_action` is narrower than before

Current rule:

- only on `event.success`, and
- `detectedIntent === true`, and
- `toolCalls === 0`

This is better than a broad “assistant sounded like it would continue” heuristic.

**Effect:** a run that already used tools is much less likely to be misclassified as a no-action stop.

### 3) tool-error recovery is less eager

Current rule distinguishes:

- `toolErrors > 0`
- but only treats it as `unrecoveredToolError` when `successfulToolCalls === 0`

So a run that had a temporary tool error but later successfully did useful work is no longer as likely to be auto-resumed unnecessarily.

**Effect:** lower false positives on mixed-success runs.

### 4) broken tail / syntax issue removal matters

The local note says the duplicate broken tail block was removed and `node --check` now passes.

That is not glamorous, but it matters: a recovery plugin that cannot even parse is worse than no plugin.

## Why this patch is closer to intended behavior

The plugin's intended behavior is narrow:

- recover from real interruption,
- avoid heavy orchestration,
- avoid becoming a noisy workflow engine,
- give a stopped task a small deterministic nudge.

After the patch, it is **closer** to that design because it now better separates:

- real timeout-like interruption,
- genuine unrecovered tool failure,
- apparent non-action termination,

and it now has a practical channel-family deny brake.

So yes:

**with this patch, the plugin is meaningfully closer to what it was supposed to be.**

## The remaining risks / caveats

## 1) `non_action` is still too heuristic for normal conversations

This is the biggest remaining issue.

The plugin still uses lexical intent patterns like:

- `let me`
- `I will`
- `I'll`
- `continue`
- `我先`
- `继续`
- `接下来`

and then treats a successful run with zero tool calls as resumable if intent was detected.

That is still dangerous in direct chats, because many perfectly normal answers contain language like:

- “I’ll explain that”
- “我先说结论”
- “接下来你可以…”
- “Let me summarize”

Those are not workflow failures. They are often just ordinary conversational phrasing.

So although the patch reduces one class of false positives, it does **not** eliminate the core semantic ambiguity.

### Judgment

- For direct-chat sessions, `non_action` is still too broad.
- This is the main reason I would **not** yet re-enable it globally.

## 2) Generic `agent_error` recovery is still broad

On `!event.success`, the plugin uses:

- `timeout` if timeout-like text is seen
- else `tool_error` if unrecovered tool error
- else `agent_error`

That means many non-success endings can still trigger resume, even if the cause was:

- external interruption,
- operator stop,
- model/provider transient weirdness,
- something that should not be blindly re-entered.

### Judgment

This is acceptable for some background tasks, but still too broad for “all sessions by default”.

## 3) State management is simple, but not obviously concurrency-hardened

Each hook does a load → modify → save cycle against one JSON state file.

That is simple and understandable, which is good.
But it also means there is still some risk of:

- interleaved hook writes,
- last-writer-wins overwrites,
- subtle stale run-state under high event concurrency.

This may be fine in light usage, but for long-term unattended reliability it is not fully hardened.

### Judgment

- probably okay for a small personal deployment,
- not yet the kind of thing I would call “battle-hardened”.

## 4) It still lacks an allowlist/positive scope model

Right now it mainly relies on:

- global enable/disable,
- cooldown,
- max auto resumes,
- deny prefixes.

That means the default safety model is still “on for many things unless denied”, not “on only for explicitly resumable task classes”.

For the user's concern about normal conversations, this matters a lot.

### Judgment

For conversation safety, an **allowlist model** would be safer than only deny prefixes.

## 5) It can still be socially noisy even when technically correct

Even if a recovery was technically justified, repeated injected instructions like:

- continue automatically
- execute the next concrete step now

can still feel intrusive in a human conversation context.

So there are two separate questions:

1. Did the plugin diagnose interruption correctly?
2. Is it socially/interaction-wise appropriate to auto-nudge this session?

The patch mainly improves (1), but not enough on (2).

## Specific judgment on “avoid disrupting normal conversations”

## Short answer

**Not fully solved yet. Improved, but not solved.**

### Why improved

Because now:

- Feishu direct sessions can be denied cleanly by prefix,
- runs with successful tool calls are less likely to be treated as no-action,
- mixed tool-error/success runs are less likely to get a noisy follow-up.

### Why not solved

Because `non_action` still depends on intent-language heuristics that are common in natural conversation.

That means the plugin is still vulnerable to this class of mistake:

- assistant produced a valid conversational answer,
- answer happened to contain future/intent phrasing,
- no tool call happened,
- plugin decides it should “continue”.

That is exactly the kind of extra “keep going” injection the user is worried about.

## Recommended operational stance right now

## Safe current stance

- Keep `auto-resume-lite` **disabled globally by default**.
- If re-enabling later, do it only after narrowing scope.
- Continue denying at least:
  - `agent:main:feishu:`
- Strongly consider also denying other human-facing direct chat families unless/until scope is redesigned.

## If the goal is background reliability, not chat recovery

Then the plugin should be moved toward one of these models:

### Option A — allowlist session families

Example philosophy:

- only resume cron / task / worker-like sessions
- do not resume direct human chat sessions by default

This is the cleanest fix.

### Option B — disable `non_action` entirely for v1

Keep only:

- timeout
- very clear unrecovered tool failure

This would sacrifice some recall, but it would strongly improve precision and reduce conversation disruption.

Given Kenny's preferences, this tradeoff is likely worth it.

### Option C — require stronger evidence before `non_action`

For example, only trigger `non_action` when multiple conditions hold, such as:

- intent detected,
- zero tool calls,
- output is short and clearly unfinished,
- session family is task-like,
- no user-facing final answer markers are present.

This is better than current behavior, but still weaker than A or B.

## My recommendation

If the plugin is brought back later, the safest next step is:

1. keep the current patch,
2. **do not** broaden enablement yet,
3. either:
   - make it allowlist-only for resumable task sessions, or
   - disable `non_action` and keep only `timeout` + strong `tool_error` recovery.

## Final verdict

### Does the patch improve stability?

**Yes.** Meaningfully.

### Is it unlikely to introduce secondary issues?

**Mostly, but not fully.**

It is unlikely to reintroduce the exact Feishu incident path that happened before.
But it can still introduce secondary issues in the form of:

- unnecessary recovery injections,
- noisy continuation nudges,
- direct-chat disruption,
- occasional state-file race edge cases.

### Is it closer to intended behavior now?

**Yes. Clearly closer.**

### Is it safe enough now for broad unattended use across normal conversations?

**No, not yet.**

### Practical decision

- good patch to keep,
- not good enough yet to trust broadly,
- especially not for human-facing direct-chat sessions unless scope is narrowed further.
