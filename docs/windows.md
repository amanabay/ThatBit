# Native Windows setup and migration

Target: Windows 11 x64, Node 24.14 or newer, current Chrome/Edge and OBS Studio. Run ReplyLink directly in Windows alongside OBS. This change prepares native Windows operation; the agent verified it on Fedora with Windows-path fixtures, not on a Windows device. Complete the acceptance steps below before recording the final demo. No cloud host, WSL, Docker, paid API or Render credit is required.

## Preserve the Fedora collection first

Stop browser capture and OBS recording, let saves finish, then stop both ReplyLink processes with Ctrl+C. Keep the original Fedora project and recordings intact until the Windows copy has been checked.

From the Fedora project directory, create a new verified private backup outside the live data directory:

```sh
npm run backup -- /home/aman/ReplyLink-migration-2026-11-02
```

If you use a custom DATA_DIR, set it explicitly for the backup command. The command verifies saved source and pending capture hashes and preserves drafts, approvals, evidence, assessments and derived creator media. It intentionally excludes Twitch tokens, .env, models and the separate reader.

With both processes stopped, also copy the entire managed reader directory (normally .data/reader) into a `reader` subdirectory of the migration backup. Preserve its reader.sqlite database, media and any SQLite sidecar files together. This retains acknowledged published copies and withdrawal tombstones. Do not start Windows with a restored creator store pointing at an empty reader while assuming old publications are available.

Optional: copy .data/models/ggml-base.en.bin and the complete .data/models/semantic directory into a `models` subdirectory of the backup. These model data files are portable. Do not carry over the Linux whisper.cpp build directory, runtime.env or node_modules. Original OBS recordings are separate from the verified backup; copy them separately if you want them on Windows. Managed saved sources are already in the backup.

Transfer the project source, including hidden .git if preserving local commits/history, and the backup privately. Git alone does not transfer ignored .data or .env. Do not upload private recordings/tokens as migration artifacts. Retain configuration values locally, then re-enter them in the new .env; log in to Twitch again on Windows.

## Install native tools

Put the project somewhere such as `C:\Projects\ReplyLink` on a local NTFS disk, outside OneDrive/network folders. In PowerShell, install missing tools through their official installers or Windows Package Manager:

```powershell
winget install --id OpenJS.NodeJS.LTS --exact
winget install --id Git.Git --exact
winget install --id OBSProject.OBSStudio --exact
winget install --id Gyan.FFmpeg --exact
```

FFmpeg must include ffprobe, libvpx-vp9, libopus, drawtext and subtitles/libass; minimal builds may omit them. FFmpeg's [download page](https://ffmpeg.org/download.html) links Windows build providers. Open a new terminal after installing so PATH updates apply.

```powershell
Set-Location C:\Projects\ReplyLink
node --version
ffmpeg -version
ffprobe -version
$env:ONNXRUNTIME_NODE_INSTALL_CUDA = "skip"
npm ci
```

Use `npm.cmd` / `npx.cmd` if PowerShell blocks the .ps1 launchers; changing global execution policy is unnecessary. Install Windows dependencies fresh with the lockfile; never copy Fedora node_modules. Windows file privacy depends on your user account's NTFS permissions; POSIX mode 0600 does not establish a Windows ACL. Keep the project and backups in a directory accessible only to the intended account.

The repository's .gitattributes keeps text at LF on Windows, preserving the frozen evaluation dataset hashes. Avoid editors or transfer tools that rewrite those JSON files to CRLF; copy them byte-for-byte or check them out with Git using the supplied attributes.

## Restore and configure

Before first launch, copy the contents of the migration backup into a fresh .data. For example, if the transferred backup is at `D:\Transfer\ReplyLink-migration-2026-11-02`:

```powershell
if (Test-Path .data) { throw "Preserve the existing .data first; restore into a fresh directory." }
Copy-Item -Recurse "D:\Transfer\ReplyLink-migration-2026-11-02" .data
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

For a fresh installation, skip the restore; the app creates its own data. Set .env with quoted forward slashes, which also work for spaces and avoid accidental backslash interpretation:

```dotenv
DATA_DIR=.data
OBS_RECORD_DIR="C:/Users/Aman/Videos/ReplyLink"
OBS_PASSWORD="your-local-OBS-WebSocket-password"
OBS_AUDIO_TRACK=1
TWITCH_CLIENT_ID=your-existing-public-client-id
TWITCH_CHANNEL=your-channel-name
```

Use your actual recording directory. Leave PUBLIC_BASE_URL/READER_URL/READER_WRITE_TOKEN unset for the supervised local workflow; dev:local supplies the loopback reader capability. Replace all old /home/... paths. Do not copy a generated Linux runtime.env. If the reader was stored elsewhere, restore it to .data/reader or explicitly set READER_DATA_DIR before launching.

## Prepare local transcription and matching

For the pinned source build, install CMake and Visual Studio 2022 Build Tools with **Desktop development with C++ / MSVC x64 tools and a Windows SDK**. CMake alone is not a C++ compiler. Reopen the terminal after installation (or use the VS developer PowerShell), then run:

```powershell
winget install --id Kitware.CMake --exact
npm run ai:setup
```

This downloads/builds local software/models; no recordings or messages are uploaded and no inference API is billed. It detects both `build/bin/Release/whisper-cli.exe` and single-configuration `build/bin/whisper-cli.exe`, and writes new quoted Windows paths to ignored .data/models/runtime.env. Keep any DLLs alongside the executable. If CMake reports a cache created on another OS/path, remove only the copied .data/models/whisper.cpp/build directory and rerun setup. Never remove the collection/media to fix a compiler error.

Alternatively, use a trusted native CPU CLI from the pinned [whisper.cpp v1.9.5 release](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.5), keeping its companion DLLs, and reuse the transferred model files. Set WHISPER_BIN to that actual .exe, WHISPER_MODEL to the .bin and MATCH_MODEL_DIR to the complete semantic directory. These explicit .env values override generated runtime.env. Copying a Linux executable does not work. A different binary changes the model/engine fingerprint: old queued analysis may require explicit retry, while saved original evidence remains unchanged.

```powershell
npm run doctor
npm run build
npm run twitch:login
npm run dev:local
```

Open http://localhost:4317 and the local reader at http://localhost:4320. Login defaults to read-only Twitch access. Check an existing draft and any restored reader replay before making new recordings. Skip `npm run demo` on a real restored collection; fixtures are optional and always labelled.

## Configure Windows OBS

In OBS, create/review Windows sources rather than expecting Fedora PipeWire/PulseAudio sources to migrate. For a coding demo use **Window Capture** for the editor/browser; use **Game Capture** for compatible games. Select the actual microphone. For application audio, use one capture route (Window/Game Capture audio where supported, or Application Audio Capture) and listen for accidental duplication with Desktop Audio. OBS documents [Window Capture](https://obsproject.com/kb/window-capture-sources) and [application audio capture](https://obsproject.com/kb/application-audio-capture-guide).

In Tools → WebSocket Server Settings enable the server on port 4455 with authentication. Match the password in .env and keep access local. Configure a split-capable MKV recording profile and the exact recording path above. The chosen recorded audio stream must contain the complete intended mix. OBS_AUDIO_TRACK is the 1-based stream position in the actual file, which can differ from mixer checkbox numbers if only selected tracks are recorded.

Start ReplyLink before starting OBS recording. It requests splits every 30 seconds; allow about 60 seconds for usable closed footage. Run `npm run obs:doctor` for anonymous read-only connection/mute/routing observations. A moving meter is not sufficient: save and play a fresh clip to verify sound, the intended window and synchronization. ReplyLink never adds an extra microphone to OBS recordings.

Browser screen/tab capture remains a separate option; shared audio availability depends on the browser, selected source and its sharing checkbox. Test audio rather than assuming a captured window includes it.

## Windows acceptance before the demo

1. `npm run doctor` passes its temporary SQLite and actual media pipeline checks. It checks model file presence, not speech accuracy.
2. Receive a fresh Twitch message; record a new audible answer crossing an OBS split. Verify the complete opening/closing words and synchronization.
3. Connect the exact message, trim, save, transcribe, correct/add captions and save. Restart the app normally; confirm the same draft and source remain.
4. Approve/render/publish locally; play the reader and captions, inspect preview and portrait, then unpublish and verify reader acknowledgement.
5. Test OBS mute, pause/resume and reconnect honestly, preserving gaps. Complete a loaded rehearsal on this new Windows setup; Fedora results do not establish Windows performance.
6. For the automated suite, install Playwright's Windows browser once: `npx playwright install chromium`, then `npm run check`. CHROMIUM_PATH is optional; never retain /usr/bin/chromium-browser. The prepared CI matrix also targets Windows but has not been run remotely by this change.

Ctrl+C asks both supervised roles to close through IPC rather than Windows' forceful SIGTERM. A fifteen-second fallback terminates stuck children; unfinished durable work recovers at the next start. Stop before backups/copying databases. On Windows, media contents are flushed before atomic rename; Node does not provide the POSIX directory-fsync path, so sudden-power-loss directory durability is not claimed equivalent.

Creator RSS/CPU and queue observations remain available. Linux process-family counters and POSIX allocated-block measurements are unavailable on Windows and remain explicitly incomplete; a rehearsal may exit nonzero for incomplete coverage. Use Task Manager and OBS Stats as separate evidence rather than interpreting missing values as zero or a complete rehearsal pass.
