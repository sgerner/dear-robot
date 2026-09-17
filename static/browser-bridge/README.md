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
4. Open the extension's **Details** page, choose **Extension options**, and save the origin of your Dear Robot app.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on**.
3. Select `manifest.firefox.json` in this directory.
4. Open the add-on's preferences and save the origin of your Dear Robot app.

Enter the origin only, such as `https://mail.example.com`, without a path. Use
`http://localhost:PORT` only for local development. If you move the app to a
different origin, update this setting and refresh the app page.

The extension is intentionally not required for ordinary mail use. It only
needs to be installed once before choosing **Automate this report** on a
specific email, then **Record in my browser** in the guided dialog. If the
dialog asks you to update the bridge, download the current archive, reload the
extension, and use its refresh button before recording again. Remove it from
the browser’s extension page whenever you are finished testing.

## Security boundary

The host permission is broad because report dashboards can live on any domain.
The extension settings store the one allowed Dear Robot app origin. The
background worker ignores page messages from other origins, checks recording
requests against that setting, and verifies each short-lived server-issued
capability with the configured app before opening a report tab. Bridge events
are forwarded only to tabs still on that exact app origin. Dear Robot still
validates the final recipe against its server-side HTTP(S) allowlist before
replaying it.
