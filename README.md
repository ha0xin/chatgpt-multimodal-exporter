# ChatGPT Multimodal Exporter

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/ha0xin/chatgpt-multimodal-exporter)

ChatGPT Multimodal Exporter is a Tampermonkey/Violentmonkey userscript that extends the ChatGPT web app with export capabilities. The script allows users to export conversation JSON data and download multimodal resources including user-uploaded attachments, images, voice mode recordings, sandbox(code interpreter) files.

<div align="center">
<img width="400" alt="ChatGPT Multimodal Exporter" src="https://github.com/user-attachments/assets/55fc1376-3e36-433c-980c-c861b1cce2dd" />
</div>

## Key Features
- **Single Conversation Export**: Export current conversation as JSON with automatic filename generation
- **Batch Export**: Select and export multiple conversations (personal and project-based) as a ZIP archive with organized folder structure
- **Auto-Save System**: Continuous background synchronization to local file system using File System Access API
- **Multimodal File Detection**: Automatically identifies and downloads various file types including:
  - User-uploaded attachments
  - Asset pointers (images, canvas outputs)
  - Sandbox/code interpreter files
  - Voice mode audio recordings
  - Inline file placeholders (file references)

## Installation & Development

### Requirements

- Node.js 18+
- pnpm

### Local Development

```bash
pnpm install
pnpm dev
```

1. After running `pnpm dev`, the browser will open a URL similar to
    `http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js`.
    Follow the instructions to install the development script in Tampermonkey / Violentmonkey.
2. Open any page on chatgpt.com. Several buttons will appear in the bottom-right corner.
    After modifying code in `src`, save and refresh the page to see the changes (HMR).

### Build & Release

```bash
pnpm build
```

The output file will be located at `dist/chatgpt-multimodal-exporter.user.js`.
 You can install it manually.

## Usage Guide

### UI

- **Export JSON**: Click on a conversation page whose URL contains `/c/{id}` to automatically save the current conversation as JSON.
- **Download Files**: Scan the current conversation for detectable files and display them in a popup. Select files to download them sequentially.
- **Batch Export**: Fetch personal and project conversation lists. You can select all or group-select conversations, and generate a ZIP after checking “Include attachments”.
- **Auto Save**: Manage auto-save settings and view the current save status.

### Output Formats

#### Single Export Output

Single conversation export produces a JSON file named `{sanitized_title}_{conversation_id}.json` containing the raw conversation object from the backend API.

#### Batch Export ZIP Structure

The script generates a ZIP archive using the `fflate` library with a hierarchical folder structure:

```
conversation-export.zip
├── summary.json                                  # BatchExportSummary
├── 001_title_convId/                             # Root conversation (if no projectId)
│   ├── conversation.json
│   ├── metadata.json                             # ConversationMetadata
│   └── attachments/
│       ├── image_abc123.png
│       └── document.pdf
├── ProjectName_timestamp/                        # Project folder
│   ├── 001_title_convId/
│   │   ├── conversation.json
│   │   ├── metadata.json
│   │   └── attachments/
│   └── 002_another_convId/
│       └── ...
└── AnotherProject/
    └── ...
```

#### Auto-Save Directory Structure

Auto-save uses the File System Access API to maintain a synchronized directory structure:

```
root_directory/
└── user@example.com/                            # User folder (email)
    ├── state.json                               # AutoSaveState tracking
    ├── Personal/                                # Personal workspace
    │   ├── conversations/                       # Category folder
    │   │   ├── conv-id-1/
    │   │   │   ├── conversation.json
    │   │   │   ├── metadata.json
    │   │   │   └── attachments/
    │   │   └── conv-id-2/
    │   │       └── ...
    │   └── project-id-xyz/                      # Project category
    │       ├── conv-id-3/
    │       └── ...
    └── workspace-id-abc/                        # Other workspace
        └── ...
```
