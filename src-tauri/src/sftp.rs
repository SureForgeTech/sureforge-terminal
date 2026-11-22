use crate::*;

// A symlink's own mode says it is a link, not what it points at, so a
// directory reached through one is listed as a file — and the file browser
// then offers to download a directory it cannot read. The browser runtime
// resolves the target with one stat per link; the native half asks the same
// question, and only for the links in a listing, which are few. A link that
// points at nothing stays a file: there is no target to read.
const LINK_DIR_MARKER: &str = "tws-link-target-is-directory";

fn link_target_directory_command(path: &str) -> String {
    let path_arg = escape_sftp_argument(path);
    format!("@test -d {} && echo {}", path_arg, LINK_DIR_MARKER)
}

#[tauri::command]
pub async fn terminal_workspace_sftp_list_directory(
    request: SftpPathRequest,
) -> Result<SftpDirectoryResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_ssh_host(&request.host)?;
        let target_path = resolve_remote_path(
            request.host.sftp_root.as_deref().unwrap_or("/"),
            &request.path,
        );
        let output =
            with_native_ssh_control_session(&request.host, &next_native_session_id(), |context| {
                run_sftp_batch_commands(
                    &request.host,
                    context,
                    &[format!("@ls -la {}", escape_sftp_argument(&target_path))],
                )
            })?;

        let mut entries = parse_sftp_directory_listing(&target_path, &output);
        let link_paths: Vec<String> = entries
            .iter()
            .filter(|entry| entry.linked)
            .map(|entry| entry.path.clone())
            .collect();
        if !link_paths.is_empty() {
            let directories = with_native_ssh_control_session(
                &request.host,
                &next_native_session_id(),
                |context| {
                    let mut hits: Vec<String> = Vec::new();
                    for path in &link_paths {
                        let command = link_target_directory_command(path);
                        let probe = run_sftp_batch_commands(&request.host, context, &[command])?;
                        if probe.contains(LINK_DIR_MARKER) {
                            hits.push(path.clone());
                        }
                    }
                    Ok(hits)
                },
            )?;
            for entry in entries.iter_mut() {
                if entry.linked && directories.contains(&entry.path) {
                    entry.kind = "directory".to_string();
                }
            }
        }

        Ok(SftpDirectoryResponse {
            entries,
            path: target_path,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn terminal_workspace_sftp_create_directory(
    request: SftpPathRequest,
) -> Result<BackendPathResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_ssh_host(&request.host)?;
        let target_path = resolve_remote_path(
            request.host.sftp_root.as_deref().unwrap_or("/"),
            &request.path,
        );
        with_native_ssh_control_session(&request.host, &next_native_session_id(), |context| {
            run_sftp_batch_commands(
                &request.host,
                context,
                &[format!("@mkdir {}", escape_sftp_argument(&target_path))],
            )
            .map(|_| BackendPathResponse {
                ok: true,
                path: target_path.clone(),
            })
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn terminal_workspace_sftp_rename_entry(
    request: SftpRenameRequest,
) -> Result<BackendPathResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_ssh_host(&request.host)?;
        let source_path = resolve_remote_path(
            request.host.sftp_root.as_deref().unwrap_or("/"),
            &request.current_path,
        );
        let target_path = resolve_remote_path(
            request.host.sftp_root.as_deref().unwrap_or("/"),
            &request.next_path,
        );
        with_native_ssh_control_session(&request.host, &next_native_session_id(), |context| {
            run_sftp_batch_commands(
                &request.host,
                context,
                &[format!(
                    "@rename {} {}",
                    escape_sftp_argument(&source_path),
                    escape_sftp_argument(&target_path)
                )],
            )
            .map(|_| BackendPathResponse {
                ok: true,
                path: target_path.clone(),
            })
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn terminal_workspace_sftp_delete_entry(
    request: SftpDeleteRequest,
) -> Result<BackendBooleanResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_ssh_host(&request.host)?;
        let target_path = resolve_remote_path(
            request.host.sftp_root.as_deref().unwrap_or("/"),
            &request.path,
        );
        with_native_ssh_control_session(&request.host, &next_native_session_id(), |context| {
            run_sftp_batch_commands(
                &request.host,
                context,
                &[format!(
                    "@{} {}",
                    if request.is_directory { "rmdir" } else { "rm" },
                    escape_sftp_argument(&target_path)
                )],
            )
            .map(|_| BackendBooleanResponse {
                ok: true,
                pending: None,
            })
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn terminal_workspace_sftp_upload_file(
    request: SftpUploadRequest,
) -> Result<BackendPathResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_ssh_host(&request.host)?;
        let target_path = resolve_remote_path(
            request.host.sftp_root.as_deref().unwrap_or("/"),
            &request.path,
        );
        let contents = BASE64_STANDARD
            .decode(request.contents_base64.as_bytes())
            .map_err(|error| error.to_string())?;
        with_native_ssh_control_session(&request.host, &next_native_session_id(), |context| {
            let upload_path = context
                .session_dir
                .join(format!("upload-{}", sanitize_filename(&request.filename)));
            fs::write(&upload_path, &contents).map_err(|error| error.to_string())?;
            run_sftp_batch_commands(
                &request.host,
                context,
                &[format!(
                    "@put {} {}",
                    escape_sftp_argument(&upload_path.to_string_lossy()),
                    escape_sftp_argument(&target_path)
                )],
            )
            .map(|_| BackendPathResponse {
                ok: true,
                path: target_path.clone(),
            })
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn terminal_workspace_sftp_download_file(
    request: SftpPathRequest,
) -> Result<BackendBinaryResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_ssh_host(&request.host)?;
        let target_path = resolve_remote_path(
            request.host.sftp_root.as_deref().unwrap_or("/"),
            &request.path,
        );
        with_native_ssh_control_session(&request.host, &next_native_session_id(), |context| {
            let filename = sanitize_filename(
                target_path
                    .rsplit('/')
                    .find(|segment| !segment.is_empty())
                    .unwrap_or("download"),
            );
            let download_path = context.session_dir.join(format!("download-{filename}"));
            run_sftp_batch_commands(
                &request.host,
                context,
                &[format!(
                    "@get {} {}",
                    escape_sftp_argument(&target_path),
                    escape_sftp_argument(&download_path.to_string_lossy())
                )],
            )?;
            let bytes = fs::read(download_path).map_err(|error| error.to_string())?;
            Ok(BackendBinaryResponse {
                base64_body: BASE64_STANDARD.encode(bytes),
                content_disposition: Some(format!("attachment; filename=\"{filename}\"")),
                content_type: Some("application/octet-stream".to_string()),
            })
        })
    })
    .await
    .map_err(|error| error.to_string())?
}
