# OS permissions

whispr-open needs two capabilities on every OS: **microphone capture** and
**text injection** (simulated keystrokes / paste into the focused app). What
that requires differs per platform.

## macOS

### Microphone

On first recording macOS shows the standard microphone consent prompt. If it
was denied, re-enable it under **System Settings → Privacy & Security →
Microphone** and toggle whispr-open on. The app's `entitlements.plist` includes
the audio-input entitlement.

### Accessibility (text injection)

Simulating keystrokes requires the **Accessibility** permission. macOS does
not prompt for it automatically in all cases — the app offers an "Open
Settings" button (the `open_permission_settings` command) that deep-links to
the exact pane:

```
x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility
```

Add whispr-open to the list and enable the checkbox. After granting, a restart
of the app may be required for the grant to take effect.

### Unsigned-build caveats

Release artifacts are currently **not code-signed or notarized**:

- Gatekeeper will refuse to open the app with "cannot be opened because the
  developer cannot be verified". Workaround: right-click → Open → Open, or
  `xattr -dr com.apple.quarantine /Applications/whispr-open.app`.
- Every rebuild of an unsigned app gets a new ad-hoc identity, so macOS
  **forgets the Accessibility grant after each update** — remove the stale
  entry and re-add the app.
- TODO: notarization. See README ("macOS signing and notarization") for the
  exact missing pieces (Developer ID certificate, tauri-action secrets,
  notarytool API key).

## Windows

### Microphone

Windows has a global privacy toggle: **Settings → Privacy & security →
Microphone**. Both "Microphone access" and "Let desktop apps access your
microphone" must be on; desktop apps are governed by the latter and do not get
per-app prompts.

### Text injection

`SendInput`-style unicode keystrokes need no special permission. Note: apps
running elevated (as Administrator) cannot receive injected input from a
non-elevated whispr-open — run whispr-open elevated too if you need to dictate
into elevated windows.

### SmartScreen (unsigned build)

The installer is not signed, so SmartScreen shows "Windows protected your PC".
Click **More info → Run anyway**. Code signing (EV or Azure Trusted Signing)
is a TODO.

## Linux

### Microphone

No permission system on bare ALSA/PulseAudio/PipeWire — if the user can access
the sound server, capture works. Select the input device in Settings if the
system default is wrong.

### Text injection — X11

Works out of the box via XTEST (`libxdo`). No configuration needed.

### Text injection — Wayland

Wayland compositors do not allow clients to synthesize input into other
windows. whispr-open uses **ydotool**, which injects at the kernel level
through `/dev/uinput`:

1. Install `ydotool` (provides `ydotool` and the `ydotoold` daemon).
2. The `ydotoold` daemon must be running (e.g. `systemctl --user enable --now
   ydotool.service`, or start `ydotoold` manually).
3. Your user needs write access to `/dev/uinput`. Example udev rule
   (`/etc/udev/rules.d/99-uinput.rules`):

   ```
   KERNEL=="uinput", GROUP="input", MODE="0660", OPTIONS+="static_node=uinput"
   ```

   Then add yourself to the group and reload:

   ```sh
   sudo usermod -aG input "$USER"
   sudo udevadm control --reload-rules && sudo udevadm trigger
   # log out and back in for the group change to apply
   ```

### Clipboard fallback

When keystroke injection is unavailable (Wayland without a working
ydotool/ydotoold/uinput setup), whispr-open falls back to **copying the
transcript to the clipboard** and notifying you (the `transcription` event
reports `injected: false`, and the UI shows a "copied to clipboard" toast).
Paste manually with Ctrl+V.
