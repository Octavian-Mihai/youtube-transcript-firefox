# Architecture

A Firefox WebExtension (Manifest V3) that copies a YouTube video's captions as timestamped text.

```mermaid
flowchart LR
    subgraph Tab["YouTube tab"]
        Main["content/main.js<br/>world: MAIN<br/>reads player caption data"]
        Iso["content/isolated.js<br/>injects Copy button, clipboard write"]
        Page[(YouTube page / player)]
    end
    Popup["popup/ (html · js · css)<br/>toolbar popup"]
    BG[background.js]
    Clip[(Clipboard)]

    Main <-->|reads| Page
    Main <-->|window.postMessage| Iso
    Popup -->|activeTab + scripting| BG
    BG -->|request transcript| Iso
    Iso --> Clip
    Popup --> Clip
```

The MAIN-world script can see page JS objects; the isolated-world script has extension APIs. They talk via `postMessage`.
