# Bump

Bump is a self-hosted, lightweight file-transfer web application designed for quickly transferring files between nearby devices.

The project is intentionally simple and browser-based. A device opens Bump in a browser, selects a file, and can pair with another device using a physical "bump" interaction.

The current implementation transfers files through the Bump server.

The long-term goal is to support direct peer-to-peer transfers through WebRTC when possible, while retaining the existing server-side transfer as an automatic fallback.

---

## Current stable baseline

This section describes the actual state of the repository, not future plans.

- **Stable commit:** `4665e30`
- **Production branch:** `main`
- **Development branch:** `develop`
- **Production worktree:** `/opt/bump`
- **Development worktree:** `/opt/bump-test`
- **Production service:** `bump.service`
- **Development service:** `bump-test.service`
- **Current transfer mechanism:** server-side HTTP transfer
- **WebRTC/P2P:** not implemented

The current version has been tested in the development environment and then deployed to production.

**The repository state and Git history are authoritative if this README and the code ever disagree.**

---

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
````

The server currently handles:

* device registration and Server-Sent Events (SSE);
* file uploads;
* temporary file storage;
* bump pairing;
* one-time download tokens;
* server-side file downloads;
* share links;
* rate limiting;
* cleanup of expired files and disconnected devices.

Application state is currently held in memory.

Files are stored temporarily on disk and are removed when they expire, are consumed, or are explicitly deleted.

---

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
│   ├── routes/
│   │   ├── bump.js
│   │   ├── download.js
│   │   ├── events.js
│   │   ├── file.js
│   │   ├── share.js
│   │   └── upload.js
│   ├── services/
│   │   ├── cleanup.js
│   │   ├── pairing.js
│   │   └── rate-limit.js
│   └── store/
│       └── memory.js
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

Runtime temporary files are stored outside the repository and are excluded from Git.

---

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

Changes should normally be developed and tested on `develop` first.

Production is updated only after the development version has been verified.

The application is run as a systemd service in both environments.

---

## Current refactoring status

The original application was implemented largely in a single `server.js`.

The code has now been separated incrementally while preserving the existing behavior after each step.

### Completed

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
15. Download route extracted into `src/routes/download.js`.
16. Upload route extracted into `src/routes/upload.js`.

The main HTTP routes have now been extracted from `server.js`.

`server.js` is intended to remain primarily an application composition/bootstrap file.

---

## Important design principles

### Keep the current behavior working

Refactoring should be incremental.

After each significant change:

1. run syntax checks;
2. restart the development/test service;
3. test the affected functionality;
4. inspect the diff;
5. commit the working change;
6. push `develop`.

Production should not be modified until the development version has been verified.

### Keep responsibilities separated

New modules should have a clear responsibility and should avoid unnecessary knowledge of Express, HTTP request/response objects, or unrelated application internals.

Prefer dependency injection where it keeps modules independent and testable.

### Do not over-engineer

Bump is a personal, lightweight application.

Do not introduce Redis, databases, queues, or other infrastructure unless there is a concrete requirement for them.

---

# Project roadmap

This roadmap records **future intentions**.

It does not describe implemented functionality.

A future developer or LLM must not interpret an item below as already implemented unless the repository and Git history confirm it.

## Phase 0 — Stabilization

**Current phase.**

Goals:

* complete the current production validation;
* maintain the README as project memory;
* establish a known stable Git baseline;
* create a release/tag for the current stable state;
* perform basic regression testing.

### Current baseline

```text
Stable commit: 4665e30
Transfer: server-side HTTP
WebRTC: not implemented
```

---

## Phase 1 — Architecture / cleanup

The major route extraction has been completed.

Remaining goals may include:

* review `server.js`;
* remove obsolete imports and dead code;
* clarify service boundaries;
* improve dependency injection where useful;
* keep the application composition/bootstrap layer small.

This phase should remain incremental and should not introduce unnecessary abstraction.

---

## Phase 2 — Security hardening

Review and, where appropriate, improve:

* upload limits;
* per-IP limits;
* concurrent connections;
* temporary-file handling;
* token entropy and expiration;
* single-use token behavior;
* SSE connection cleanup;
* HTTP security headers;
* error handling;
* malformed or abusive requests.

Security changes must preserve the normal transfer workflow.

---

## Phase 3 — WebRTC / P2P

Long-term goal: transfer the file directly between the two browsers when possible.

Target architecture:

```text
                 Bump server
              signaling / pairing
                  /         \
                 /           \
                v             v
           Browser A <----> Browser B
                    WebRTC
                 DataChannel
```

Initial goals:

* establish a WebRTC connection between two paired browsers;
* exchange signaling information through the Bump server;
* transfer a small file directly between the two devices;
* initially test on simple networks such as the same LAN.

The existing server-side transfer must remain available during development.

---

## Phase 4 — Server fallback

WebRTC should not become a single point of failure.

Target behavior:

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

The server-side transfer is therefore not considered obsolete. It remains an important compatibility and reliability mechanism.

---

## Phase 5 — User experience

Improve transfer feedback and usability:

* upload/download progress;
* transfer speed;
* remaining time;
* clear connection states;
* cancellation;
* useful error messages;
* better mobile behavior;
* clearer indication of whether the transfer is P2P or server-side, if useful.

---

## Phase 6 — Reliability

Handle real-world failure cases:

* browser closing during transfer;
* device going offline;
* network changes;
* Wi-Fi changes;
* disconnected SSE sessions;
* interrupted uploads;
* interrupted downloads;
* failed WebRTC connections;
* simultaneous pairing attempts;
* multiple devices bumping at nearly the same time;
* large files;
* multiple files.

---

## Phase 7 — Automated tests

Introduce automated tests for the most important application logic, including:

* pairing;
* rate limiting;
* upload handling;
* download handling;
* share links;
* token expiration;
* cleanup;
* error cases.

The goal is to reduce dependence on manual two-device testing for every change.

---

## Phase 8 — CI / releases

After automated tests exist:

* add GitHub Actions;
* run syntax checks and tests on pushes/pull requests;
* keep `main` releasable;
* introduce semantic versioning where appropriate;
* maintain a changelog;
* create tagged releases.

---

# Future WebRTC technical roadmap

The WebRTC implementation is expected to use browser-native APIs such as:

* `RTCPeerConnection`;
* `RTCDataChannel`;
* ICE candidate exchange;
* STUN;
* TURN when necessary.

For real file transfers, the implementation will eventually need to address:

* chunking;
* large files;
* multiple files;
* backpressure;
* memory usage;
* progress reporting;
* cancellation;
* timeouts;
* connection failures;
* browser compatibility;
* mobile compatibility.

These are planned capabilities, not current capabilities.

---

# Future LLM / developer context

When continuing development from this repository, first inspect:

1. `README.md`;
2. the current Git branch;
3. the current Git status;
4. `server.js`;
5. `src/config.js`;
6. `src/store/memory.js`;
7. `src/services/`;
8. `src/routes/`;
9. recent Git history.

Do not assume that the roadmap has already been implemented.

**The repository state and Git history are authoritative.**

If the README and the code disagree, inspect the code and Git history before making changes.

### Preferred development approach

For each coherent change:

1. inspect the current implementation;
2. make one small change;
3. run syntax checks;
4. restart the development/test service;
5. test the affected functionality;
6. inspect the diff;
7. commit the working change;
8. push `develop`;
9. only after validation consider promoting it to `main`.

Avoid changing production directly during development.

---

# Current status

At the current stable baseline:

* the development branch is `develop`;
* the production branch is `main`;
* both branches point to the same stable commit after the latest promotion;
* the development/test instance is working;
* the production instance is working;
* the frontend is localized;
* the application has been refactored into routes, services, store, and configuration modules;
* server-side HTTP file transfer is the active transfer mechanism;
* WebRTC/P2P transfer has **not** been implemented;
* automatic WebRTC fallback has **not** been implemented;
* automated tests have **not** yet been implemented;
* CI has **not** yet been implemented.

The next planned milestone is **Phase 0 — Stabilization**.
