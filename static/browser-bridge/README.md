# Dear Robot Browser Bridge

This small extension lets Dear Robot record a report workflow in the browser
the user is already using. It opens the dashboard in a new tab and records
clicks, non-secret form values, and downloads only while the user has
explicitly started a recording from an email. Redirect URLs are intentionally
not recorded because they often contain short-lived sign-in tokens.

The bridge does not send passwords, one-time codes, or cookies anywhere.
Password, username, and recognizable email-code fields are represented as
`secretRef` values (`password`, `username`, and `email_code`); the
Dear Robot setup dialog can optionally save the actual credentials encrypted on
the server.

## Local installation

You can download the bundled archive from the Dear Robot setup dialog (or from
`/browser-bridge/dear-robot-browser-bridge.zip`) and unzip it first. The
`extension` directory inside the archive is the folder you load below.

### Chrome or Chromium

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this `extension` directory.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on**.
3. Select `manifest.firefox.json` in this directory.

The extension is intentionally not required for ordinary mail use. It only
needs to be installed once before choosing **Automate this report** on a
specific email, then **Record in my browser** in the guided dialog. If the
dialog asks you to update the bridge, download the current archive, reload the
extension, and use its refresh button before recording again. Remove it from
the browser’s extension page whenever you are finished testing.

## Security boundary

The host permission is broad because report dashboards can live on any domain.
The content script is idle until Dear Robot sends an explicit recording command
with a short-lived, server-issued capability bound to the current email setup.
The extension verifies that capability with Dear Robot before opening a report
tab, so an unrelated webpage cannot impersonate the app and start recording.
Dear Robot still validates the final recipe against its server-side HTTP(S)
allowlist before replaying it.
