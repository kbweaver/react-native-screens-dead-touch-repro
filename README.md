# react-native-screens: background screens break after a window resize (Android, Fabric)

This repo contains two minimal apps that reproduce the same react-native-screens bug.

| App | Window config | Trigger |
| --- | --- | --- |
| `keyboard-repro/` | `edgeToEdgeEnabled=false` | software keyboard opens and closes |
| `splitscreen-repro/` | `edgeToEdgeEnabled=true` | app enters and leaves split screen |

Each app shows its own step-by-step instructions on screen.

## The bug

A screen sits behind the visible screen of a native stack.
The window is resized while that screen is in the background.
After navigating back to it, the screen looks normal but no Pressable on it works.
Every press shows its highlight, fires `onPressIn`, and is then cancelled before `onPress`.
Rotating the device fixes the screen.

## Facts

1. Since react-native-screens 4.19.0, a Fabric commit hook resets the frame state of **every** Screen shadow node when the orientation flips ([#3295](https://github.com/software-mansion/react-native-screens/pull/3295)). Since 4.21.0 it fires on any root layout-constraint change ([#3508](https://github.com/software-mansion/react-native-screens/pull/3508)).
2. Root layout constraints change on every keyboard show/hide when edge-to-edge is off, on every split-screen or multi-window resize, and on every orientation change.
3. The reset relies on the native side to repopulate the frame state: `Screen.onLayout` → `updateShadowNodeScreenSize`.
4. Screens behind the visible screen of a native stack are detached, so they receive no `onLayout` while the resize happens.
5. `Screen.onLayout` only dispatches the update when the native bounds changed (`if (changed && ...)`, [Screen.kt](https://github.com/software-mansion/react-native-screens/blob/4.27.0/android/src/main/java/com/swmansion/rnscreens/Screen.kt#L239)). Re-attaching a screen at unchanged bounds therefore skips the update.
6. `Pressability` measures press rectangles through the Fabric shadow tree, and cancels a press when the touch moves outside the measured rectangle.
7. Real finger taps always produce touch-move events. Mouse clicks and `adb shell input tap` produce none.
8. The bug reproduces on 4.21.0 through 4.27.0 (latest at time of writing). The same commit-hook condition is present in 5.0.0-alpha.2. It does not reproduce on 4.17.x–4.20 (the hook, introduced in [#3295](https://github.com/software-mansion/react-native-screens/pull/3295) in 4.19, fired only on orientation flips).
9. The commit hook is only registered when the experimental feature flag `androidResetScreenShadowStateOnOrientationChangeEnabled` is true, which is the default.
10. Issue [#4289](https://github.com/software-mansion/react-native-screens/issues/4289) reports the same stale-hit-testing defect with the orientation-change trigger.
11. The orientation trigger reproduces in these apps too: on Screen C, rotate to landscape and back to portrait, then return to Screen B. This works in either app and does not involve the keyboard.
12. The pre-4.21 condition revert (below) does not protect against the orientation trigger, because that condition still fires on orientation flips. The feature flag (fact 9) disables the hook for all triggers.

## Conclusions from the facts

- After a background-screen resize cycle, the shadow tree holds stale geometry for that screen while its native views are correct (facts 1–5).
- Every real finger press on that screen is cancelled by the stale measurement (facts 6–7).
- Zero-movement inputs (emulator mouse, `input tap`) still work, so the bug is invisible in mouse-driven testing (fact 7).
- Migrating to edge-to-edge removes the keyboard trigger but not the multi-window trigger (fact 2). The `splitscreen-repro` app demonstrates this.

## Recordings

Scripted repro runs on a Pixel 9 Pro API 33 emulator, stock screens 4.27.0:

- [videos/keyboard-repro.mp4](videos/keyboard-repro.mp4) — keyboard trigger. Baseline
  presses on Screen B count normally; after the keyboard cycle on Screen C, the plain
  tap still counts but both jittery taps show the pressed highlight and never count.
- [videos/splitscreen-repro.mp4](videos/splitscreen-repro.mp4) — split-screen trigger on
  the fully edge-to-edge app, keyboard never involved. Same outcome.

## Reproducing

Follow the numbered steps shown inside each app.

```bash
cd keyboard-repro    # or splitscreen-repro
yarn install
yarn android
```

Use a real finger on a device, or simulate finger jitter on an emulator:

```bash
adb shell input tap X Y                            # zero movement: works even when broken
adb shell input swipe X Y $((X+5)) $((Y+5)) 100    # 5px jitter: press cancels when broken
```

`X Y` is the center of a row on Screen B. Events log to `adb logcat -s ReactNativeJS`.
A cancelled press logs `pressIn row N` with no matching `press row N`.

## Verification results

Scripted cold-launch trials, Pixel 9 Pro API 33 emulator, screens 4.27.0:

| Arm | Result |
| --- | --- |
| keyboard trigger, edge-to-edge off | 15/15 runs: presses cancelled |
| split-screen trigger, edge-to-edge on | 3/3 runs: presses cancelled |
| orientation flip (landscape and back) while Screen B detached | 2/2 runs: presses cancelled |
| keyboard trigger, edge-to-edge on (control) | 3/3 runs: healthy |
| commit-hook condition reverted to pre-4.21 (one line, below) | 15/15 runs: healthy |
| keyboard trigger, flag `androidResetScreenShadowStateOnOrientationChangeEnabled=false` | 3/3 runs: healthy |

The one-line change used for the last arm, in
`common/cpp/react/renderer/components/rnscreens/RNSScreenShadowNodeCommitHook.h`:

```cpp
// instead of: any width/height change
const bool wasHorizontal = oldLayoutConstraints.maximumSize.width >
    oldLayoutConstraints.maximumSize.height;
const bool willBeHorizontal = newLayoutConstraints.maximumSize.width >
    newLayoutConstraints.maximumSize.height;
return wasHorizontal != willBeHorizontal;
```

This restores the pre-4.21 behavior and is a workaround, not a fix: it also disables the
split-screen/multi-window handling that #3508 added.

An alternative workaround needs no native patch. Set the experimental feature flag before
any screen mounts (fact 9):

```ts
import {featureFlags} from 'react-native-screens';

featureFlags.experiment.androidResetScreenShadowStateOnOrientationChangeEnabled = false;
```

This disables the commit hook entirely, so it also disables the orientation-change layout
fix from #3295.

## Fix verification: PR #4336

[PR #4336](https://github.com/software-mansion/react-native-screens/pull/4336) (open at
time of writing) fixes the repopulation path: `Screen.onLayout` always dispatches the
state update, and a screen resets its stored sizes when it goes below the stack, so
returning to it cannot skip the refresh. We applied its diff to these apps and re-ran the
trials:

| Trigger | Stock 4.27.0 | 4.27.0 + PR #4336 |
| --- | --- | --- |
| keyboard show/hide (edge-to-edge off) | 15/15 presses cancelled | 3/3 healthy |
| split screen in/out (edge-to-edge on) | 3/3 presses cancelled | 3/3 healthy |
| orientation flip and back | 2/2 presses cancelled | 3/3 healthy |

The fix covers all three triggers and keeps both the #3295 orientation fix and the #3508
multi-window handling.

## Notes for reproducing in other apps

- Screen B must not be the first screen in the stack. When it is, the stale geometry is
  applied visibly instead: the whole screen shifts by the top-inset height and presses
  keep working at the shifted positions.
- Press targets must be small. A press is cancelled only when the jitter exits the stale
  rectangle plus `pressRetentionOffset`; the stale offset is about one top-inset, so tall
  buttons absorb it. The rows in these apps are 24dp with `pressRetentionOffset={0}`.
