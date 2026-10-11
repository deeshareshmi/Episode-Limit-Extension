# Netflix Daily Pause — version 0.5.1

Local Chrome Manifest V3 extension, plain JavaScript, no build or packages. Settings, logs, decisions and break timers stay in `chrome.storage.local`. No backend, telemetry, remote scripts, Netflix private APIs or DRM/media interception.

## The requested flow

| Stage | Choices and requirements |
| --- | --- |
| First daily episode/minute breach | **Stop for today**, or **Watch another episode** after a **60-second break** |
| First extra episode ends / another video is requested | Stop, or one final extra episode after a **five-minute break** and typing exactly **I want to watch one more episode** |
| Second extra episode ends / another video is requested | **Automatic Netflix-wide lockout until local midnight. No concessions.** |

There is no separate 30-minute continuation, combined-limit checkbox or free-form reason. The original optional stopping reason remains visible. The exact confirmation is case-sensitive; surrounding whitespace is ignored. The first break starts when the first prompt appears. The second starts at the next boundary. Timers and concessions persist across tabs, reloads and browser/worker restarts.

Counting and permission remain separate: an identified episode counts after five minutes of accumulated playback, but reaching the episode count lets that admitted episode finish unless the original minute limit intervenes. Once a concession is approved, it permits **one watch-page video to finish, despite either daily threshold**. A minute-limit interruption therefore resumes the current episode; at an episode boundary, the concession permits the next video. Moving to another watch ID uses up the concession even if you skip the ending. A movie uses playback minutes, and an approved continuation covers the remainder of that movie/video rather than inventing an episode.

The continuation button stays visible and dimmed during both breaks, with **Watch another episode (1:00)** or **Watch another episode (5:00)** counting down on the button. At zero the label becomes **Watch another episode**. There is no separate countdown, permission-count message, or break-complete message. It becomes active when the break finishes; the second concession also requires the exact confirmation sentence. The normal popup shows totals and the episode log without explaining future concessions or the counting threshold.

**Missing title metadata no longer removes the continuation button.** Concessions are bound to the Netflix `/watch/<id>` identity, independently of title extraction. An unidentified video contributes minutes but never gets an invented episode-log entry. This can make the number of identified episodes lower than the number of concessions used.

## Update or load in Brave / Chrome

1. Open `brave://extensions` in Brave, or `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. First installation: click **Load unpacked** and select `C:\Users\deesha.reshmi\Desktop\Prep\New folder`, the outer folder containing `manifest.json`. The nested `New-folder` checkout is not updated.
4. Existing installation: click **Reload** on Netflix Daily Pause and verify **0.5.1**. No new permissions are added in 0.5.1.
5. **Reload every Netflix tab.** Old content scripts must be replaced together with the worker.
6. On first installation, the packaged welcome page opens automatically. Set your limits and optional reason, then click **Save settings**. Closing it without saving leaves the defaults (2 episodes / 90 minutes) active.
7. For an existing installation, open the popup and click **Open settings & guide** to see the new page. Reloads, upgrades and browser restarts do not automatically open welcome. Pin the extension for quick everyday checks and edits.
8. Open Netflix, sign in yourself, and briefly reveal player controls so title metadata can be captured.

Brave uses the same Chromium extension APIs here; no Brave-specific codebase is needed. The extension must be enabled in the browser profile being used. For private windows, explicitly enable **Allow in private/incognito** in the extension's details if you want those windows covered too.

Upgrading from 0.4.x preserves settings, totals, episode logs, active break deadlines, concessions and lockout. No viewing data is reset. For legacy pre-0.4 state, the existing migration still removes old time-based allowances, restarts legacy break timers, and locks a previously completed second extra episode. Previously unidentifiable viewing cannot safely be reconstructed as episode entries.

## Local settings and guide page

The **Open settings & guide** popup button and the browser's extension **Options** action open `options.html` in a full tab. This is a packaged extension page, not a hosted website. All scripts, styles and charts are local; there are no accounts, external fonts or analytics. Opening the first-install tab follows the [Chrome onboarding API](https://developer.chrome.com/docs/extensions/reference/api/tabs#open-an-extension-page-in-a-new-tab), which does not need the `tabs` permission.

- **Today:** current totals and identified episode log, updated while playback is tracked.
- **Your limits:** the same daily limits, optional reason and diagnostic preference as the popup. Click **Save settings** to apply changes.
- **Viewing history:** separate minute and episode bar charts, defaulting to the last 7 calendar days; choose 30 days for a longer view. Click a date bar, or focus it and press Enter/Space, to open its episode log. The daily list shows the last 90 recorded dates, newest first.
- **How it works:** limits, both breaks, typed confirmation, whole-site lockout, midnight release and local storage. Diagnostics are inside collapsed **Troubleshooting**.

Saved changes update open views and the Netflix intervention. Unsubmitted fields stay as drafts; saves send only changed fields to the worker, so independent edits do not overwrite each other. When two views save the same field, the last successful save wins. Changing settings does not cancel an active break, approved extra video or lockout.

Charts use local calendar dates, including today. A dashed bar means no record is available; a zero baseline means a day was recorded with zero viewing. Partial identified episodes remain in logs but do not add a counted episode until the existing threshold. Movie and unknown-video time stays in minute totals without invented episode entries. Past charts show recorded activity, not comparisons against today's limits.

The worker's existing `settings` message accepts partial or full settings. A read-only `history` message returns `{today, days:[{date, ms, count, episodes}]}`, capped at 90 recorded dates. The shared `ui.js` handles forms and storage notifications; all state writes remain serialized in the worker.

## Whole-site lockout and permissions

- `storage`: local totals, settings, history and policy state.
- `declarativeNetRequest`: installs one persistent rule blocking **top-level navigation to netflix.com and its subdomains** after the final concession, or after choosing Stop for today. It does not intercept request contents and has no rules for other websites.
- `alarms`: removes the rule at local midnight, even if the popup and Netflix tabs are closed. The worker checks/recreates this alarm whenever it starts.

New Netflix navigations are blocked by the browser and may display its standard **ERR_BLOCKED_BY_CLIENT** / blocked-by-extension page. Already-open Netflix pages receive a full-page lock screen, have their media paused, and their page controls disabled. Reloading, opening another Netflix tab or editing daily limits does not clear a lockout. Settings edits also do not cancel an active break or concession.

The dynamic blocking rule persists while the worker sleeps and across browser sessions. Midnight release is checked at startup, alarm delivery and ordinary extension messages. If the machine/browser slept through midnight, release occurs after it wakes/starts and processes the alarm/state check; reload a previously blocked error page afterwards. Browser alarms can be delayed, so this is not a precise-to-the-second unlock guarantee. The implementation follows Chrome's [declarativeNetRequest](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest) and [alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms) APIs.

This remains a personal-use extension: it cannot enforce the lock if you deliberately disable/remove it, use a profile where it is absent, or edit its local state/code.

## Tracking, tabs, dates and logging

- Only advancing main-video playback on `/watch/<id>` is timed. Pauses, seeking, stalls, sleep-like gaps and recognized previews do not add playback time. At 2x, one real minute still counts as one playback minute.
- Episodes count after five minutes accumulated per watch ID and local day, even when stopped before credits. Resuming/rewatching adds to the existing daily entry without another episode count.
- Hidden controls can reuse a known identity only for the exact same watch ID. Saved log metadata provides the same exact-ID recovery after refresh. Unknown intervals are not retrospectively assigned to episodes.
- Concurrent tabs share one policy, concession counter and daily lock. Playback minutes from simultaneously playing streams are summed. A paused unrelated tab does not consume the extra episode; explicitly playing another ID ends the current concession.
- Midnight splits a crossing sample and starts fresh daily totals, breaks and permissions. A continuing episode can count on both days if it gets five minutes on each. Unlocking never automatically starts playback.
- The last 90 recorded days are retained; the popup shows today. Removing the extension clears its local data.

## Detection and enforcement limits

`detector.js` isolates Netflix selectors and metadata/transition assumptions. It finds the main `.watch-video` / `[data-uia="watch-video"]` container and the largest video inside it. Candidate player titles use `[data-uia="video-title"]`, `.video-title`, `[data-uia="player-title"]` and `.watch-video--title`, including controls mounted outside the video container.

Split text nodes are joined with spaces. Explicit English season/episode labels and series-only episode-selector controls can establish episode identity. Missing numbers stay blank. A title or watch ID alone is not enough to invent episode metadata. Localized or changed Netflix layouts can require detector updates; the watch-ID concession still works when title text is missing.

Recognized Next buttons/watch links inside the player are intercepted before Netflix's click handler, checked by the worker, and released once after permission. Autoplay uses URL changes, media events, title mutations and a one-second fallback poll. Seeking to the end is treated as ending the concession. An unrecognized control, unchanged URL across different content, stale metadata, or browser throttling can defeat or delay boundary detection; this is not frame-perfect autoplay prevention.

Browse previews are excluded by the watch-page/main-video requirement, and explicit trailer/preview markers are ignored. Unlabeled ads or previews inside the main video may remain indistinguishable. Samples over five seconds or with suspicious position jumps are discarded. Buffering/event boundaries can slightly undercount; abrupt closure can lose the final sample. Receipt-time assignment near midnight can shift a delayed small interval.

## Diagnostics

Enable **detector diagnostics**, save, reveal Netflix controls, and expand **Latest detector observation** in the popup. It refreshes about every five seconds. Inspect `extensionVersion`, `watchId`, `classification`, `effectiveIdentity`, `blockReason`, `title`, `detail`, candidate selectors, `seriesControl`, `titleLabels`, `playerText` and playback status. Only the latest observation is saved, with its timestamp and tab ID.

Observations can include visible subtitles/player labels. They stay local unless you copy them. If titles are missing, an approved allowance still follows the watch ID; the episode log remains conservative. If even the main video is missing, the detector needs a selector repair before playback tracking can be trusted.

## Automated checks

With Node.js 18+ installed, run from this folder:

```sh
node tests/run.cjs
node tests/worker.cjs
node tests/browser-check.cjs "C:/Program Files/Google/Chrome/Application/chrome.exe"
node tests/ui-check.cjs "C:/Program Files/Google/Chrome/Application/chrome.exe"
```

No `npm install` is needed. Verified for version 0.5.1:

- **24 policy/sampler/detector checks**: both initial limits, exact 60-second and five-minute breaks, exact confirmation, unknown titles, allowance scope, automatic final lock, two tabs, resume/deduplication, movies, seeking, speed, migration, persistence and midnight.
- **17 worker checks**: serialized writes, restart, breaks, concessions, network-rule construction, midnight release, first-install-only welcome, partial/concurrent settings saves, validation, read-only history and its retention view. Chrome's storage, tabs, network-rule and alarm APIs are mocked.
- **9 player browser checks**: actual content script/DOM/Next interception, dimmed button countdowns, missing-title continuation, saved-settings refresh, exact typing and full-page/media lock. The video clock and Chrome transport are mocked.
- **8 settings-page browser checks**: production worker, popup and options scripts with DOM rendering, bidirectional saves, drafts, validation, diagnostics, both chart ranges, selectable dates, missing/zero records, partial logs, live playback updates, preserved restrictions, midnight, empty history and narrow layout. Chrome APIs and the calendar are mocked; no real personal viewing data is used.

Both browser runners use new headless Chrome profiles, never your signed-in browser. The UI runner serves a test-only fixture on 127.0.0.1; the installed extension itself does not need a server. Desktop welcome/history and narrow page layouts were also inspected using screenshots. Pass a Brave executable path to try the same fixture there. The in-app browser connection was unavailable, and a previous isolated Brave run timed out. **The revised flow and real Brave network blocking have not been verified in a live authenticated Netflix session.** The tests validate local behavior and rule construction, not live Netflix DOM/API integration.

For interactive checks, open `tests/mock.html`. **Advance mock clock past break** is available only in the simulation. Its data is in memory and its simulated lock cannot block actual Netflix. `tests/browser.html` runs the DOM fixture directly.

## Manual welcome, page and synchronization checks

1. In your existing Brave/Chrome profile, reload version **0.5.1**. Confirm no welcome tab opens automatically. Open the popup and choose **Open settings & guide**; the full page should open locally.
2. To test first installation without losing existing history, create a separate temporary browser profile and load the outer folder there. Confirm welcome opens once with default limits; save them and confirm the normal settings view appears. Reload the extension and restart the browser: welcome must not reopen.
3. With the full page open, change a limit in the popup and save; confirm the page updates. Save a different value on the page and reopen the popup to check it. Leave an unsaved field on the page, then save a different field in the popup: the draft must remain.
4. During a Netflix pause, change the reason or limit on the page. Confirm the intervention updates without restarting its countdown or clearing restrictions. Settings must not unlock a stopped day.
5. Play identifiable episodes, a partial episode and a movie/unknown title. Confirm live totals and the two chart ranges, date selection by mouse/keyboard, episode details, zero versus missing dates, and the narrow layout. Only identifiable episodes belong in logs.
6. Leave the page open across local midnight: totals should reset, charts should shift to the new day, and previous history should remain. An explicitly selected past date should stay selected.

## Manual acceptance test on Netflix

1. Reload the extension and all Netflix tabs. Confirm **0.5.1**.
2. Set one daily episode and a high minute limit. At 4:59 of accumulated playback, confirm the episode has not counted. At 5:00, confirm count 1 and verify the current episode keeps playing.
3. End it or choose Next. Confirm Stop plus the dimmed episode continuation with **Watch another episode (1:00)** on the button. It must stay visible even if the next title is unknown, and disabled until the break finishes. Confirm the same countdown on the second concession button, starting at **5:00**, with the exact confirmation still required.
4. Approve the first concession. Confirm exactly the next/current watch ID plays, without an immediate re-prompt. Its ending or a Next attempt must open the **5:00** break.
5. After five minutes, type a different sentence and confirm it fails. Type exactly **I want to watch one more episode** and confirm the final extra episode plays.
6. Finish that episode or try Next. Confirm automatic lock, no further concession, and paused playback in other open Netflix tabs.
7. Open Netflix's home page and a direct watch URL in new tabs. Both must be blocked by the extension. Restart Brave and repeat. Changing settings must not unlock it.
8. Separately test a low minute limit: the first breach must offer the same 60-second-break/one-video flow. A granted current episode may finish past the daily minute threshold.
9. Test Stop for today, hidden titles, manual Next, autoplay, fullscreen, pause/seek/buffering, two tabs and midnight. At midnight the rule should be removed after the alarm/state check, and no video should start automatically.

For independent test scenarios only, reset this extension's data in its service-worker **Inspect** console with `chrome.storage.local.clear()`, then **reload the extension** to reconcile/remove its persistent network rule, and reload Netflix tabs. This deletes all extension settings and logs. Do not reset if you want to retain them.

## Files

- `engine.js`: daily ledger and the normal → break → concession → locked policy.
- `site-lock.js`: persistent Netflix navigation rule and midnight alarm.
- `background.js`: serialized persistence, rule reconciliation and startup/alarm handling.
- `tracker.js`: playback sampling independent of Netflix.
- `detector.js`: Netflix-specific identity and transition assumptions.
- `content.js`: player enforcement, Next interception, prompt and full-page lock.
- `popup.*`: quick settings, totals, episode logs, diagnostics and the full-page link.
- `options.*`: welcome, full settings, charts, daily history and guide.
- `ui.js`: shared form synchronization, local-date helpers and log rendering.
- `tests/`: deterministic tests, mocked worker, player DOM fixture, and options/popup fixture with a local test server.
