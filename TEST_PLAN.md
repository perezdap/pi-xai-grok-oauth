# pi-xai-grok-oauth — Pre-Publish Test Plan

Goal: Verify the extension is stable enough for public npm publishing. All tests must pass before `v0.1.0` (or next release).

---

## Environment Setup

- **pi version**: (fill in after `/version`)
- **OS**: Windows 11
- **Node version**: (run `node -v`)
- **Extension path**: `~/.pi/agent/extensions/xai-grok-oauth/index.ts`
- **GitHub repo**: https://github.com/perezdap/pi-xai-grok-oauth

Before each test session:

```text
/reload
```

---

## Core Functionality Tests

### 1. OAuth Login Flow

| Step | Action | Expected Result | Status |
|------|--------|-------------------|--------|
| 1.1 | Run `/login xai-oauth` | Browser opens to xAI auth page | ⬜ |
| 1.2 | Complete browser authorization | Callback succeeds, pi shows "Login successful" | ⬜ |
| 1.3 | Run `/model xai-oauth/grok-build` | Model switches without error | ⬜ |
| 1.4 | Send a simple prompt: "Say hello" | Response streams normally | ⬜ |

**Notes:**

---

### 2. Multi-Turn Text Conversation (grok-build)

| Step | Prompt | Expected Result | Status |
|------|--------|-------------------|--------|
| 2.1 | "Explain quantum computing in 3 sentences" | Clean response | ⬜ |
| 2.2 | "Now make it shorter" | Follow-up works, no 400/422 | ⬜ |
| 2.3 | "Can you give me an analogy?" | Third turn works | ⬜ |
| 2.4 | "Summarize our conversation" | Fourth turn works, no replay errors | ⬜ |
| 2.5 | "What was the first thing I asked?" | Memory/context intact | ⬜ |

**Watch for:**
- `Error: 400 "Model grok-build does not support parameter reasoningEffort"`
- `Error: 400 "Each message must have at least one content element"`
- Any other 400/422/500 errors

**Notes:**

---

### 3. Multi-Turn with grok-4.3

| Step | Prompt | Expected Result | Status |
|------|--------|-------------------|--------|
| 3.1 | `/model xai-oauth/grok-4.3` | Switch succeeds | ⬜ |
| 3.2 | "Write a Python function to reverse a string" | Clean response with code | ⬜ |
| 3.3 | "Make it handle Unicode" | Follow-up works | ⬜ |
| 3.4 | "Add type hints" | Third turn works | ⬜ |

**Notes:**

---

### 4. Fresh Session Test

| Step | Action | Expected Result | Status |
|------|--------|-------------------|--------|
| 4.1 | Start brand new pi session (`/new`) | Session opens clean | ⬜ |
| 4.2 | `/model xai-oauth/grok-build` without re-login | Token still valid, model switches | ⬜ |
| 4.3 | Send first prompt | No stale replay artifacts | ⬜ |

**Notes:**

---

### 5. Image Input Handling

| Step | Action | Expected Result | Status |
|------|--------|-------------------|--------|
| 5.1 | Paste/screenshot an image into pi with grok-build | Should NOT crash with 422 | ⬜ |
| 5.2 | Send prompt alongside image: "What's in this image?" | Placeholder text shown, no crash | ⬜ |
| 5.3 | Continue conversation after image attempt | Follow-up turns work normally | ⬜ |

**Expected behavior:** Image is replaced with placeholder text:
> `[Image input omitted — xAI Responses API does not support image uploads]`

**Watch for:**
- `Error: 422 "Failed to deserialize the JSON body into the target type: data did not match any variant of untagged enum ModelInput"`

**Notes:**

---

### 6. Tool Use

| Step | Prompt | Expected Result | Status |
|------|--------|-------------------|--------|
| 6.1 | "Read the file README.md in the current directory" | Model calls `read` tool, gets content | ⬜ |
| 6.2 | "Run `git status` and summarize" | Model calls `bash` tool, runs command | ⬜ |
| 6.3 | "Now write a summary to summary.txt" | Model calls `write` tool, creates file | ⬜ |

**Notes:**

---

### 7. Session Persistence & Restore

| Step | Action | Expected Result | Status |
|------|--------|-------------------|--------|
| 7.1 | Have an active conversation with grok-build | Session file has entries | ⬜ |
| 7.2 | Exit pi (`Ctrl+C` or quit) | Clean exit | ⬜ |
| 7.3 | Reopen pi in same directory | Previous session restored | ⬜ |
| 7.4 | `/model xai-oauth/grok-build` | Model still available, no re-login needed | ⬜ |
| 7.5 | Continue conversation | Works from restored state | ⬜ |

**Notes:**

---

### 8. Reload Stability

| Step | Action | Expected Result | Status |
|------|--------|-------------------|--------|
| 8.1 | Run `/reload` mid-conversation | Extension reloads cleanly | ⬜ |
| 8.2 | Send prompt after reload | Works normally | ⬜ |
| 8.3 | Run `/reload` 3 times in a row | No state corruption | ⬜ |
| 8.4 | Switch models after reload | `/model xai-oauth/grok-4.3` works | ⬜ |

**Notes:**

---

### 9. Long Context / Large Prompt

| Step | Action | Expected Result | Status |
|------|--------|-------------------|--------|
| 9.1 | Paste a large text block (~5k tokens) | Accepted without error | ⬜ |
| 9.2 | Ask model to summarize the large text | Response streams | ⬜ |
| 9.3 | Ask follow-up about specific detail in text | Context preserved | ⬜ |

**Notes:**

---

### 10. Other Models

| Model | Simple Prompt | Follow-up | Status |
|-------|---------------|-----------|--------|
| `grok-4.20-0309-reasoning` | ⬜ | ⬜ | ⬜ |
| `grok-4.20-0309-non-reasoning` | ⬜ | ⬜ | ⬜ |
| `grok-4.20-multi-agent-0309` | ⬜ | ⬜ | ⬜ |

**Notes:**

---

## Sign-off

| Criterion | Required | Pass? |
|-----------|----------|-------|
| No 400/422/500 errors across all tests | ✅ | ⬜ |
| Multi-turn conversations stable (5+ turns) | ✅ | ⬜ |
| Image input handled gracefully (no crash) | ✅ | ⬜ |
| OAuth token refresh works (no re-login needed) | ✅ | ⬜ |
| Tool use functional | ✅ | ⬜ |
| Session restore works | ✅ | ⬜ |

**Tested by:** _________________  
**Date completed:** _________________  
**Go / No-Go for publish:** _________________

---

## If a Test Fails

1. Note the exact error message in the **Notes** section
2. Run `/reload` and retry
3. If reproducible, open an issue: https://github.com/perezdap/pi-xai-grok-oauth/issues
4. Do **not** publish until fixed and retested
