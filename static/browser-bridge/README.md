# Dear Robot Browser Bridge

This small extension lets Dear Robot record a report workflow in the browser
the user is already using. It opens the dashboard in a new tab, records clicks,
navigation, non-secret form values, and downloads only while the user has
explicitly started a recording from an email.

The bridge does not send passwords or cookies anywhere. Password and username
fields are represented as `secretRef` values (`password` and `username`); the
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
needs to be installed once before choosing **Record in my browser** in the
Dear Robot email flow. Remove it from the browser’s extension page whenever
you are finished testing.

## Security boundary

The host permission is broad because report dashboards can live on any domain.
The content script is idle until Dear Robot sends an explicit recording command.
Dear Robot still validates the final recipe against its server-side HTTP(S)
allowlist before replaying it.
