# Testing checklist

Run the app with `npm run tauri dev` (first build takes a few minutes). Tick items as you go and note
anything odd next to it; that list becomes the next round of changes.

Automated tests (already passing): `npm run test:aerie` and `cd src-tauri && cargo test --lib aerie`.

## Shell and look
- [ ] Pill shows at the top centre; hover peeks, click opens the panel.
- [ ] Material panel: tool name + date + time in the header, icon dock at the bottom, hover a dock icon for its name.
- [ ] Aerie tab (palette icon) > Look: Theme Material/Glass, Colours from Wallpaper/Album/Windows/Custom, Mode, Style all apply live.
- [ ] Wallpaper colours: with Wallpaper Engine off, the palette follows the Windows wallpaper (blue bloom gives blue tones).
- [ ] Stay out of the way: Open on hover Off, Idle look Slim line, Hide now; Ctrl+Alt+N hides and shows.
- [ ] Settings > Layout: hide a few tools you do not use; they disappear from the dock.

## Clipboard (Ctrl+C in any app)
- [ ] Text, a link, an image (screenshot) and files copied in Explorer all appear in Clipboard > History.
- [ ] Search, filters (All/Text/Links/Images/Files), pin, delete, Clear unpinned (asks twice).
- [ ] Clicking a clip copies it back; paste in Notepad.
- [ ] Copy from KeePassXC / Bitwarden desktop: nothing is recorded.
- [ ] Settings (gear): pause recording, keep-for days, history size, never-record app list.

## Paste stack
- [ ] Ctrl+Alt+C turns collecting on (Stack view switch turns on); copy three things; they appear numbered.
- [ ] In Notepad press Ctrl+Alt+V three times: the three items paste in order.
- [ ] Add to stack from a History item; remove and clear work.

## Shelf and snippets
- [ ] Drag files onto the open panel (Shelf tab): they appear; drag one out into a folder or app; "Copy" then paste in Explorer.
- [ ] Move a shelved file elsewhere: its row shows struck through.
- [ ] Snippets: add one with `{date}` and `{?name}`; using it asks for name and copies the expanded text.

## Focus (tasks) and reminders
- [ ] Type "test reminder in 2 minutes" in Focus > Tasks: the due time shows before adding; a Windows notification arrives on time and the pill shows it.
- [ ] "pay rent on friday" shows Friday (09:00 reminder).

## Mic, camera, voice
- [ ] Ctrl+Alt+M: tap mutes (badge left of the pill), tap again unmutes. While muted, hold to talk, release mutes.
- [ ] Mic tab: big button mirrors the state; Camera mirror shows a mirrored preview; camera light goes off when leaving the tab.
- [ ] Ctrl+Alt+R records from any app (red dot by the pill); again stops; the memo appears in Voice with play, rename, show in folder, delete.
- [ ] Recording while muted is refused with a message.

## Teleprompter
- [ ] Prompter tab: new script, paste text, set speed or "Fit to" 1:00 + Enter, Start reading.
- [ ] Window appears under the camera with a 3 s countdown; Space pauses; Ctrl+Alt+P toggles; Ctrl+Alt+Shift+Up/Down change speed; Esc closes.
- [ ] Start a Teams/Zoom/OBS screen share: the prompter is not visible to others (needs "Hide from screen sharing").

## Phone link (Pixel + KDE Connect app)
- [ ] Install KDE Connect from the Play Store. Phone and PC on the same Wi-Fi. Quit the KDE Connect desktop app on Windows if installed (it uses the same port).
- [ ] Phone tab > Turn on phone link; allow the Windows firewall prompt (private networks).
- [ ] The Pixel appears (or add the PC by the IP shown); pair from either side; codes match.
- [ ] Battery shows; Ring my phone rings it.
- [ ] In KDE Connect on the phone: enable Notification sync and grant notification access; phone notifications appear in the Phone tab and as Windows notifications; dismissing one clears it on the phone.
- [ ] Copy text on the PC: it is on the phone's clipboard (and the reverse, via KDE Connect's clipboard send).
- [ ] Share a photo from the phone to the PC: it lands in Downloads. Send Shelf files to the phone with the send icon.

## Known limits
- **On this PC, Ctrl+Alt+M and Ctrl+Alt+R are already taken by another app**, so mic mute and voice
  recording hotkeys did not register (the Mic and Voice tab buttons still work). Pick other combos and
  they will be changed; a shortcut editor is on the list.
- Pasting into apps running as administrator needs Aerie run as administrator.
- Wallpaper Engine's animated wallpaper is not read; the static Windows wallpaper is.
- No "another app is using your camera/mic" dot yet.
