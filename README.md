# Bump

Bump is a self-hosted, lightweight file-transfer web application designed for quickly transferring files between nearby devices.

The project is intentionally simple and browser-based. A device opens Bump in a browser, selects a file, and can pair with another device using a physical "bump" interaction. The current implementation transfers files through the Bump server.

The project is being refactored incrementally with the future goal of supporting direct peer-to-peer transfers through WebRTC, while retaining the existing server-side transfer as a fallback.

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

The server currently handles:

- device registration and Server-Sent Events (SSE);
- file uploads;
- temporary file storage;
- bump pairing;
- one-time download tokens;
- server-side file downloads;
- rate limiting;
- cleanup of expired files and disconnected devices.

Application state is currently held in memory. Files are stored temporarily on disk and are removed when they expire or are consumed.

## Repository structure

```text
bump/
├── server.js
├── package.json
├── package-lock.json
├── .gitignore
├── README.md
├── src/
│   ├── routes/
│   │   ├── events.js
│   │   ├── file.js
│   │   ├── share.js
│   │   └── bump.js
│   ├── services/
│   │   ├── cleanup.js
│   │   ├── rate-limit.js
│   │   └── pairing.js
│   └── store/
│       └── memory.js
└── public/
    ├── index.html
    ├── qrcode.min.js
    ├── css/
    │   └── style.css
    ├── js/
    │   ├── app.js
    │   └── i18n.js
    └── locales/
        ├── ar.json
        ├── de.json
        ├── en.json
        ├── es.json
        ├── fr.json
        ├── hi.json
        ├── it.json
        ├── ja.json
        ├── ko.json
        ├── nl.json
        ├── no.json
        ├── pl.json
        ├── pt.json
        ├── ru.json
        ├── sv.json
        ├── tr.json
        ├── uk.json
        └── zh.json
```

Runtime temporary files are stored in `tmp/` and are excluded from Git.

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

Changes should normally be developed and tested on `develop` first. Production is updated only after the test version has been verified.

The application is run as a systemd service in both environments.

## Current refactoring status

The original application was implemented largely in a single `server.js`.

The code is being separated gradually, while preserving the existing behavior after every step.

Completed:
1. Frontend moved into `public/`.
2. CSS moved into `public/css/style.css`.
3. Frontend JavaScript moved into `public/js/app.js`.
4. QRCode library kept locally under `public/`.
5. Frontend localization extracted into `public/js/i18n.js` and `public/locales/`.
6. Server configuration extracted into `src/config.js`.
7. In-memory application state extracted into `src/store/memory.js`.
8. Rate limiting extracted into `src/services/rate-limit.js`.
9. Pairing logic extracted into `src/services/pairing.js`.
10. Cleanup / maintenance logic extracted into `src/services/cleanup.js`.
11. SSE events route extracted into `src/routes/events.js`.
12. File management route extracted into `src/routes/file.js`.
13. Share-link route extracted into `src/routes/share.js`.
14. Bump route extracted into `src/routes/bump.js`.

The remaining HTTP routes are still being extracted incrementally from `server.js`.

## Important design principles

### Keep the current behavior working

Refactoring should be incremental. After each significant change:

1. run syntax checks;
2. restart the development/test service;
3. test the affected functionality;
4. commit the change;
5. push `develop`.

Production should not be modified until the development version has been verified.

### Keep responsibilities separated

New modules should have a clear responsibility and should avoid unnecessary knowledge of Express, HTTP request/response objects, or unrelated application internals.

Prefer dependency injection where it keeps modules independent and testable.

### Do not over-engineer

Bump is a personal, lightweight application. Do not introduce Redis, databases, queues, or other infrastructure unless there is a concrete requirement for them.

## Planned refactoring

The next refactoring steps are expected to include:

- isolate download handling;
- isolate upload handling;
- make `server.js` primarily an application composition/bootstrap file.

The exact module boundaries should be decided incrementally rather than creating a large number of files at once.

## Future WebRTC roadmap

The long-term goal is to make the actual file transfer peer-to-peer when possible.

The server should remain responsible for coordination/signaling, but should not normally receive the file.

Target architecture:

```text
                  Bump server
               signaling / pairing
                    /       \\
                   /         \\
                  v           v
             Browser A <----> Browser B
                    WebRTC
                 DataChannel
```

The existing server-side transfer must remain available as a fallback.

### Phase 1 — Basic P2P

Introduce WebRTC using `RTCPeerConnection` and `RTCDataChannel`.

Initial goal:

- establish a WebRTC connection between two paired browsers;
- exchange signaling information through the Bump server;
- transfer a small file directly between the two devices;
- initially test in simple network conditions, such as devices on the same LAN.

The existing server-side transfer remains available during development.

### Phase 2 — Robust file transfer

Make the WebRTC transfer suitable for real files:

- chunking;
- large files;
- multiple files;
- transfer progress;
- backpressure;
- cancellation;
- timeouts;
- connection errors;
- browser/mobile compatibility;
- appropriate memory usage.

### Phase 3 — Internet connectivity

Handle real-world network conditions using WebRTC ICE:

- STUN;
- ICE candidate exchange;
- connection establishment across different networks;
- TURN as a relay when a direct P2P connection cannot be established.

### Final transfer strategy

The intended behavior is:

```text
                 Pairing / signaling
                         |
                         v
                Try WebRTC P2P first
                    /           \\
                 works          fails
                   |              |
                   v              v
             A <--------> B   A -> server -> B
                WebRTC          fallback
```

The fallback should be automatic and transparent to the user whenever possible.

The server-side transfer is therefore not considered obsolete: it is an important compatibility and reliability mechanism.

## Future LLM / developer context

When continuing development from this repository, first inspect:

1. `README.md`;
2. the current Git branch;
3. `server.js`;
4. `src/config.js`;
5. `src/store/memory.js`;
6. `src/services/`.
7. `src/routes/`.

Do not assume that the roadmap has already been implemented. The repository state and Git history are authoritative.

The preferred development approach is incremental:

- understand the current implementation;
- make one coherent change;
- run syntax checks;
- test the development service;
- commit the working change;
- only then continue with the next refactoring step.

Avoid changing production directly during development.

## Current status

At the time this README was written:

- the `develop` branch contains the incremental refactoring completed so far;
- the development/test instance is working;
- the production instance remains separate on `main`;
- WebRTC/P2P transfer has not yet been implemented;
- server-side file transfer remains the active transfer mechanism.
