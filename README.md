# Bump

Bump is a self-hosted, lightweight file-transfer web application designed to quickly transfer files between nearby devices.

The application is entirely browser-based. A device opens Bump in a browser, selects a file, and can pair with another device using a physical "bump" interaction.

The current implementation transfers files through the Bump server.

The long-term goal is to support direct peer-to-peer transfers through WebRTC while retaining the existing server-side transfer as a reliable fallback.

## Current architecture

```text
Browser A
   |
   | HTTP / SSE
   v
Bump server
   |
   | HTTP / SSE
   v
Browser B
```

The Bump server currently handles:

* device registration;
* Server-Sent Events (SSE);
* file uploads;
* temporary file storage;
* bump pairing;
* one-time download tokens;
* server-side file downloads;
* share links;
* rate limiting;
* cleanup of expired files and disconnected devices;
* frontend localization preparation.

Application state is currently held in memory.

Uploaded files are stored temporarily on disk and are removed when they expire or are consumed.

## Current features

### Device pairing

Bump supports pairing between nearby devices using:

* keyboard interaction on computers;
* motion detection on compatible mobile devices.

The pairing service validates the timing and type of bump events before creating a one-time download token.

### File transfer

The current transfer path is:

```text
Browser A
    |
    | upload
    v
Bump server
    |
    | one-time download URL
    v
Browser B
```

The server temporarily stores the uploaded file.

### Share links

Files can also be shared through temporary share links.

### Localization

The application includes a configurable localization system.

The frontend uses `public/js/i18n.js` to load and apply translations from `public/locales/`.

Translation sources are stored under:

```text
src/locales/
```

The available translations are prepared for the frontend when the server starts.

The current configuration supports 53 languages, with English (`en`) as the fallback language.

## Repository structure

```text
bump/
├── server.js
├── package.json
├── package-lock.json
├── .gitignore
├── README.md
│
├── src/
│   ├── config.js
│   │
│   ├── routes/
│   │   ├── bump.js
│   │   ├── download.js
│   │   ├── events.js
│   │   ├── file.js
│   │   ├── share.js
│   │   └── upload.js
│   │
│   ├── services/
│   │   ├── cleanup.js
│   │   ├── device.js
│   │   ├── locales.js
│   │   ├── pairing.js
│   │   ├── rate-limit.js
│   │   └── sse.js
│   │
│   ├── store/
│   │   └── memory.js
│   │
│   └── locales/
│       ├── config.json
│       └── translations/
│
└── public/
    ├── index.html
    ├── qrcode.min.js
    ├── css/
    │   └── style.css
    ├── js/
    │   ├── app.js
    │   └── i18n.js
    └── locales/
```

Runtime temporary files are stored in:

```text
tmp/
```

The temporary directory is excluded from Git.

## Application structure

### `server.js`

`server.js` is the application composition and bootstrap point.

It is responsible for:

* loading configuration;
* initializing application services;
* preparing the temporary directory;
* preparing frontend translations;
* creating the Express application;
* registering routes;
* starting cleanup;
* starting the HTTP server.

Business logic is kept outside `server.js` whenever there is a clear module boundary.

### Routes

HTTP route handling is separated into individual modules:

* `routes/events.js` — SSE connections;
* `routes/file.js` — pending-file management;
* `routes/bump.js` — bump events;
* `routes/download.js` — one-time file downloads;
* `routes/share.js` — temporary share links;
* `routes/upload.js` — file uploads.

### Services

Application services contain reusable logic that does not need to be implemented directly inside an HTTP route.

* `services/pairing.js` — pairing state machine;
* `services/rate-limit.js` — rate limiting;
* `services/cleanup.js` — periodic maintenance;
* `services/device.js` — device state helpers;
* `services/sse.js` — SSE event sending;
* `services/locales.js` — preparation of frontend localization files.

Frontend localization is implemented in `public/js/i18n.js` and the generated files under `public/locales/`.

### Store

`store/memory.js` contains the application's in-memory state.

There is currently no external database or persistent application state.

### Configuration

`config.js` contains server configuration and application limits, including:

* HTTP host and port;
* temporary directory;
* upload limits;
* per-IP limits;
* pairing timing;
* file lifetime;
* download-token lifetime;
* share-link lifetime.

## Development / production workflow

The project uses two branches and two working directories:

```text
/opt/bump-test  -> develop -> development and testing
/opt/bump       -> main    -> production
```

GitHub branches:

```text
origin/develop -> development
origin/main    -> production
```

Development changes are made on `develop`.

Production is kept separate on `main` and should not be modified directly during development.

Both environments run as systemd services.

## Development principles

### Preserve behavior

Refactoring should preserve the existing application behavior.

After each significant change:

1. run syntax checks;
2. run the automated tests;
3. restart the development/test service;
4. verify the affected functionality;
5. inspect the Git diff;
6. commit the change;
7. push `develop`.

Production should only be updated after the development version has been verified.

### Keep responsibilities separated

New modules should have a clear responsibility.

Avoid unnecessary coupling between:

* HTTP routes;
* application services;
* application state;
* configuration;
* frontend code.

Prefer dependency injection when it keeps modules independent and testable.

### Do not over-engineer

Bump is intentionally lightweight.

Do not introduce Redis, databases, queues, message brokers, or other infrastructure unless there is a concrete requirement for them.

The current in-memory architecture is intentional.

## Current refactoring status

The original application was implemented largely in a single `server.js`.

The code is being separated incrementally while preserving existing behavior.

Completed refactoring steps include:

1. frontend moved into `public/`;
2. CSS moved into `public/css/style.css`;
3. frontend JavaScript moved into `public/js/app.js`;
4. QRCode library kept locally under `public/`;
5. frontend localization implemented through `public/js/i18n.js` and `public/locales/`;
6. server configuration extracted into `src/config.js`;
7. in-memory application state extracted into `src/store/memory.js`;
8. rate limiting extracted into `src/services/rate-limit.js`;
9. pairing logic extracted into `src/services/pairing.js`;
10. cleanup and maintenance logic extracted into `src/services/cleanup.js`;
11. SSE route extracted into `src/routes/events.js`;
12. file-management route extracted into `src/routes/file.js`;
13. share-link route extracted into `src/routes/share.js`;
14. bump route extracted into `src/routes/bump.js`;
15. download route extracted into `src/routes/download.js`;
16. upload route extracted into `src/routes/upload.js`;
17. localization preparation extracted into `src/services/locales.js`;
18. device state helpers extracted into `src/services/device.js`;
19. SSE sending extracted into `src/services/sse.js`.

The current `server.js` is primarily responsible for application composition and bootstrap.

The refactoring remains incremental: module boundaries should only be introduced when they represent a clear responsibility.

## Tests

The project uses Node's built-in test runner.

Run the test suite with:

```bash
npm test
```

The current development branch has automated coverage for:

* localization;
* pairing;
* uploads;
* downloads;
* share links;
* rate limiting;
* cleanup.

At the current development state, the test suite contains 50 tests.

The development service is also tested separately from the unit tests to verify that the complete application can start successfully.

## Future WebRTC roadmap

The long-term goal is to make the actual file transfer peer-to-peer whenever possible.

The server should remain responsible for coordination and signaling, but should not normally receive the file.

Target architecture:

```text
                  Bump server
               signaling / pairing
                    /       \
                   /         \
                  v           v
             Browser A <----> Browser B
                    WebRTC
                 DataChannel
```

The existing server-side transfer must remain available as a fallback.

### Phase 1 — Basic P2P

Introduce WebRTC using:

* `RTCPeerConnection`;
* `RTCDataChannel`.

Initial goals:

* establish a WebRTC connection between two paired browsers;
* exchange signaling information through the Bump server;
* transfer a small file directly between the two devices;
* initially test in simple network conditions such as devices on the same LAN.

The existing server-side transfer remains available during development.

### WebRTC signaling design

The first WebRTC implementation will use the existing Bump server as a signaling relay.

The server will coordinate the peers but will not participate in the actual file transfer.

The signaling flow is:

```text
Browser A                    Bump server                    Browser B
    |                              |                              |
    |------ pairing -------------->|<------------- pairing -------|
    |                              |                              |
    |<----- session-ready ---------|------ session-ready -------->|
    |                              |                              |
    |---------- offer ------------>|---------- offer ------------>|
    |                              |                              |
    |<--------- answer ------------|<--------- answer ------------|
    |                              |                              |
    |---------- ICE -------------->|---------- ICE -------------->|
    |<--------- ICE ---------------|<--------- ICE ---------------|
    |                              |                              |
    |========== WebRTC DataChannel / P2P ========================|
```

A successful pairing creates a short-lived WebRTC session between the two devices.

The signaling protocol will initially use these message types:

* `webrtc-offer`;
* `webrtc-answer`;
* `webrtc-ice`.

Each signaling message belongs to a specific WebRTC session.

Conceptual offer:

```json
{
  "type": "webrtc-offer",
  "session": "session-id",
  "description": {
    "type": "offer",
    "sdp": "..."
  }
}
```

Conceptual answer:

```json
{
  "type": "webrtc-answer",
  "session": "session-id",
  "description": {
    "type": "answer",
    "sdp": "..."
  }
}
```

Conceptual ICE candidate:

```json
{
  "type": "webrtc-ice",
  "session": "session-id",
  "candidate": {
    "...": "..."
  }
}
```

The exact contents of SDP and ICE candidates are generated and interpreted by the browser. The Bump server only validates the session and peer association and forwards the signaling messages to the other device.

The signaling session must be associated with the two device IDs that were produced by the existing pairing mechanism. A signaling message from another device must not be accepted for that session.

The WebRTC session is therefore derived from the existing pairing mechanism rather than introducing a second device-discovery mechanism.

During Phase 1, the signaling implementation will initially be tested on simple network conditions, especially devices connected to the same LAN.

No STUN or TURN infrastructure is required for the first local-network prototype. Internet connectivity and TURN fallback are part of Phase 3.

The existing server-side file transfer remains unchanged while the WebRTC prototype is developed.

### Phase 2 — Robust file transfer

Make WebRTC transfer suitable for real files:

* chunking;
* large files;
* multiple files;
* transfer progress;
* backpressure;
* cancellation;
* timeouts;
* connection errors;
* browser/mobile compatibility;
* appropriate memory usage.

### Phase 3 — Internet connectivity

Handle real-world network conditions using WebRTC ICE:

* STUN;
* ICE candidate exchange;
* connection establishment across different networks;
* TURN as a relay when a direct P2P connection cannot be established.

### Final transfer strategy

The intended behavior is:

```text
                 Pairing / signaling
                         |
                         v
                Try WebRTC P2P first
                    /           \
                 works          fails
                   |              |
                   v              v
             A <--------> B   A -> server -> B
                WebRTC          fallback
```

The fallback should be automatic and transparent to the user whenever possible.

The server-side transfer is therefore not considered obsolete: it remains an important compatibility and reliability mechanism.

## Future developer / LLM context

When continuing development from this repository, first inspect:

1. `README.md`;
2. the current Git branch;
3. `server.js`;
4. `src/config.js`;
5. `src/store/memory.js`;
6. `src/routes/`;
7. `src/services/`;
8. `src/locales/`.

Do not assume that the roadmap has already been implemented.

The repository state and Git history are authoritative.

The preferred development approach is incremental:

* understand the current implementation;
* make one coherent change;
* run syntax checks;
* run the test suite;
* test the development service;
* inspect the diff;
* commit the working change;
* push `develop`;
* only then continue with the next change.

Avoid changing production directly during development.

## Current status

At the current development state:

* `main` contains the stable production baseline;
* `develop` contains the ongoing refactoring;
* the development/test instance is working;
* the production instance remains separate;
* the server-side transfer is the current operational transfer mechanism;
* frontend localization is implemented;
* the application has been separated into routes, services, store, configuration and localization components;
* automated tests currently pass;
* WebRTC/P2P transfer has not yet been implemented;
* automatic P2P-to-server fallback has not yet been implemented.

The next development work should continue from the current `develop` branch rather than from the production `main` branch.
