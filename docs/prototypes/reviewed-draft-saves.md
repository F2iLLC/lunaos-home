# Reviewed fictional draft saves

Plugin 0.2.0 connects a locally confirmed draft field to the existing Windows encrypted adapter through the shared version 2 permission service. Earlier storage tests proved persistence in a separate harness; plugin 0.1.1 still used only an in-memory draft. This change connects those paths for fixed fictional examples.

## Local workflow

Call `home_open_home` for the current link, including after restarting the plugin. It opens the review screen without creating a draft or reading stored records. Keep the link fragment: it carries a process capability. Do not put this link in logs or public evidence.

After choosing **Looks right**, choose **Save this detail**. Home shows the exact value and, when present, the stored value it would replace. **Save on this computer** approves that one record for up to one minute. Cancel or expiry ends the approval. Only Alex Example's Workplace and Library and Sam Example's School are supported; this is not arbitrary household import. Suggestions are not saved. Duplicate names/labels and unsupported or unchecked details are refused.

Use **View saved examples** for a local read, including after closing and restarting the plugin. Saving or viewing grants no assistant disclosure. Discarding a draft leaves saved examples intact. Displayed values and pending approvals clear on backgrounding; displayed values expire after one minute. Save approval is consumed once, and no save operation is exposed through MCP.

The service issues only one-record create/edit permission for the selected operation. Updates compare the saved revision shown during approval. A concurrent change fails without overwrite. An uncertain write consumes approval and requires explicit readback before another approval; no automatic retry occurs. The link capability, same-origin checks, structured request validation and bounded request body protect the local HTTP route from unrelated web origins. They do not authenticate a human or protect against another process running as the same Windows user.

## Storage boundary

Windows saving requires Node 24 and PowerShell 7 (`pwsh`). The dedicated store uses the existing CurrentUser DPAPI adapter outside the checkout under Windows LocalApplicationData. Its fixed identifier is `b203ff13-756b-4c0d-a7f7-a54ed592d864`; plugin upgrades and restarts reopen that store. This identifier is not a secret or an unlock credential. Earlier disposable test stores are not imported.

Reading an absent store returns no examples without creating it. The first approved save initializes it. A corrupt or missing record envelope inside an existing directory fails closed; it is never replaced by an empty store. Existing atomic ciphertext replacement and per-operation storage/lifecycle locks apply. The plugin has no recovery/import/delete operation. Its MCP tools never read the saved store or put its contents into draft-review responses. Tests select a fresh UUID through the privileged launcher environment `LUNA_HOME_FICTIONAL_STORE_ID` and clean up only that owned store; MCP inputs cannot select a filesystem location or store.

This is fictional persistence, not production vault acceptance: there is no OS-authentication-bound key release, separate vault unlock, phone sync, backup/recovery UI, or real-data acceptance. Other operating systems and the packaged native offline preview remain draft-only. Confirmed drafts are still volatile until explicitly saved.

## Validation

The Windows suite passed 303/303 on this implementation, and the native offline frontend built successfully. New tests cover confirmed-field enforcement, separate single-use approval, expiry/cancel, stale draft refusal, duplicate identity refusal, concurrent record conflict, preserved Sam records, lost receipts and readback, HTTP capability/origin/input boundaries, actual encrypted reopen and tamper refusal. UI tests exercise the replacement preview, separate save click, uncertain-result recovery, late response suppression and offline refusal.

The relocated installed-package regression launches the packaged MCP process, stages/corrects/confirms the fictional draft, explicitly saves through the local HTTP harness, closes the process, starts a new one, calls `home_open_home`, and reads the saved example locally. The new process has an empty draft, rejects old draft IDs and does not disclose the saved value through `home_review_requests`. Tests remove their own disposable store. This is real encrypted persistence across process restart with protocol-driven local approval, not a physical computer reboot or human GUI acceptance of the new save screen. The operator's ChatGPT Work review report applied to 0.1.1 before saving was added.

Version 0.2.0 was installed through the local plugin CLI. The same persistence probe passed against the actual installed cache copy. The native client discovery probe also passed, reporting installed version 0.2.0 and all four tools without invoking a model or touching the default saved-example store. Active older conversations were not restarted or migrated.
