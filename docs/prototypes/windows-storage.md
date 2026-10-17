# Windows protected-storage experiment

This is the first bounded implementation experiment for [Session 2](https://github.com/F2iLLC/lunaos-home/issues/14). The [owner disposition](https://github.com/F2iLLC/lunaos-home/issues/14#issuecomment-6228967257) permits the verified Windows Claude Code route and direct/manual Android Home, retaining phone-only manual storage. [Issue 31](https://github.com/F2iLLC/lunaos-home/issues/31) preserves mobile assistant automation and ChatGPT integration as future work. The [Session 1 handoff](session-one-handoff.md) supplies the device/client evidence; open issue metadata is not itself an unmet technical check.

## Run the fixed synthetic experiment

Use Windows and PowerShell 7. From the repository root:

```powershell
pwsh -NoProfile -NonInteractive -File scripts/probe-windows-storage.ps1
```

The script accepts no record input. It uses a fixed fictional Alex/Sam JSON document, with member designations in one blob. It creates a unique directory under the current user's LocalApplicationData `LunaOSHome/FictionalStorageProbes`, outside the checkout; disables inherited directory access and grants only the current user and LocalSystem access; and writes four ciphertext files. Existing reparse-point paths are rejected. The user-selected vault location and its backup exclusions are not implemented by this temporary location.

Separate child processes write and read the encrypted blob. The runner checks exact recovery, different ciphertext from repeated encryption, rejection of altered/truncated blobs and a mismatched public purpose value, and successful reading of the unchanged original after those failures. It scans all four output files for the fixture markers in UTF-8 and UTF-16. The script reports only check results/runtime versions, never decrypted records, account identifiers, ciphertext, keys or local paths. The isolated run directory is removed in `finally`, using only its four known filenames and a nonrecursive directory removal. It does not delete other directories or change global settings.

Run is opt-in, outside `npm test`, because it executes Windows protection and creates temporary files. Non-Windows environments fail explicitly. Internal phase parameters exist only to run the same fixed fixture in fresh processes; they are not a general storage API.

## Facility and limits

The original probe calls the installed .NET `ProtectedData` wrapper with `DataProtectionScope.CurrentUser`, which uses Windows DPAPI. It contains no cryptographic algorithm, managed password, new package or vendored third-party source. A fixed public purpose string binds the experiment's calls; it is not secret entropy or an authorization grant. [Microsoft ProtectedData documentation](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata).

DPAPI ordinarily ties decryption to the Windows logon context. That is **not a Home unlock prompt or per-workflow permission**: another process under the same user can call it. Windows profile/roaming and recovery arrangements also matter; this experiment does not establish device-exclusive key custody or cross-user denial. [Microsoft DPAPI scope and roaming remarks](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata).

Observed October 16, 2026 (America/Chicago), Windows build 26300 and PowerShell 7.6.5:

| Check | Result |
| --- | --- |
| Write and recover in different fresh processes | Passed; exact fixed document with two fictional member designations recovered. |
| Altered ciphertext / truncated ciphertext | Both rejected by the cryptographic facility. |
| Mismatched purpose | Rejected; not a substitute for testing another Windows account or family admission. |
| Read original after failures | Passed, with exact original content. |
| Encrypt the same fixture again | Ciphertext differed. |
| Inspect the four files written by this probe | No specified UTF-8/UTF-16 fixture markers found. This is a bounded file-content check, not a scan of OS paging, memory, crash dumps, backups or all machine logs. |
| Cleanup | Unique probe directory removed. |

This is an OS-facility experiment, **not the native app's storage adapter**. Neither the GUI nor MCP can save records through it. It adds no listener, app permission, assistant disclosure, Android capability or production security claim. File ACL configuration is not proof of denial under a second account; that has not been exercised. The fixture strings exist intentionally in source and process memory, so clearing byte arrays is not a secure-memory guarantee.

## Next experiments and Session 2 exit gaps

1. Select the actual shared storage/key adapter and reviewed format, including schema validation, bounded reads, atomic updates and crash behavior. Consider DPAPI for wrapping a data key rather than treating this whole-record fixture format as the product format.
2. Prove trusted OS unlock and cancellation separately; never collect a Windows password. Test the selected Android Keystore/private-storage counterpart on the phone, including phone-only operation.
3. Integrate the same enforcing service with the GUI and local assistant, with explicit family admission, session-limited setup writes, read-only grants, revocation and scoped disclosure.
4. Prove authenticated direct phone/computer pairing, disconnect/unknown-write handling, sleep/suspension and user-held recovery. No cloud relay or public vault endpoint.

Session 2 is in progress, not accepted. The full encrypted round trip on both chosen targets, OS unlock, phone-only path, direct bridge, unauthorized-client denial and session expiry still need evidence. Production sensitive-use, independent security review and binary-distribution gates remain open. Actions stays disabled.
