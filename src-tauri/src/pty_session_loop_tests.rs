//! #483: tests that run the two production PTY session loops,
//! `run_external_command_session_loop` and `run_jump_host_session_loop`, end to
//! end, through a recording event sink instead of a Tauri window.
//!
//! They exist so the two loops can later be merged into one with proof that
//! nothing changed. Every test has a time limit: a hung loop is the failure
//! mode these loops have shown before, and it must fail the test rather than
//! hang the suite.

use super::*;
use serde_json::Value;
use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};

const LOOP_TIME_LIMIT: Duration = Duration::from_secs(20);
static SESSION_SEQ: AtomicUsize = AtomicUsize::new(0);

/// One event the loop sent, decoded. `Message` carries the decoded session
/// message (`{"type": "data" | "status" | "error", ...}`).
#[derive(Clone, Debug)]
enum Recorded {
    Message(Value),
    Close,
}

pub(crate) type CloseProbe = Arc<dyn Fn() -> bool + Send + Sync>;

#[derive(Clone)]
pub(crate) struct RecordingSink {
    events: Arc<Mutex<Vec<Recorded>>>,
    /// Evaluated at the moment the close event is sent, so a test can see
    /// what exists on disk at that point (cleanup before or after close).
    close_probe: Option<CloseProbe>,
    close_probe_result: Arc<Mutex<Option<bool>>>,
}

impl RecordingSink {
    fn new(close_probe: Option<CloseProbe>) -> Self {
        Self {
            events: Arc::default(),
            close_probe,
            close_probe_result: Arc::default(),
        }
    }

    fn events(&self) -> Vec<Recorded> {
        self.events.lock_recover().clone()
    }

    pub(crate) fn output(&self) -> String {
        self.events()
            .iter()
            .filter_map(|event| match event {
                Recorded::Message(value) if value["type"] == "data" => {
                    value["data"].as_str().map(str::to_string)
                }
                _ => None,
            })
            .collect()
    }

    pub(crate) fn statuses(&self) -> Vec<String> {
        self.events()
            .iter()
            .filter_map(|event| match event {
                Recorded::Message(value) if value["type"] == "status" => {
                    value["state"].as_str().map(str::to_string)
                }
                _ => None,
            })
            .collect()
    }

    pub(crate) fn errors(&self) -> Vec<String> {
        self.events()
            .iter()
            .filter_map(|event| match event {
                Recorded::Message(value) if value["type"] == "error" => {
                    value["message"].as_str().map(str::to_string)
                }
                _ => None,
            })
            .collect()
    }

    /// Short labels in order, e.g. `status:connected`, `data`, `error`, `close`.
    fn timeline(&self) -> Vec<String> {
        self.events()
            .iter()
            .map(|event| match event {
                Recorded::Close => "close".to_string(),
                Recorded::Message(value) => match value["type"].as_str() {
                    Some("status") => format!("status:{}", value["state"].as_str().unwrap_or("")),
                    Some(other) => other.to_string(),
                    None => "unknown".to_string(),
                },
            })
            .collect()
    }

    pub(crate) fn wait_for_output(&self, needle: &str) {
        let deadline = Instant::now() + LOOP_TIME_LIMIT;
        while !self.output().contains(needle) {
            assert!(
                Instant::now() < deadline,
                "timed out waiting for {needle:?}; output so far: {:?}",
                self.output()
            );
            thread::sleep(Duration::from_millis(10));
        }
    }
}

impl SessionEventSink for RecordingSink {
    fn emit_stream_event(&self, event: SessionStreamEvent) {
        let recorded = match event.kind {
            "close" => {
                if let Some(probe) = &self.close_probe {
                    *self.close_probe_result.lock_recover() = Some(probe());
                }
                Recorded::Close
            }
            _ => {
                let raw = event.data.expect("message events carry data");
                Recorded::Message(serde_json::from_str(&raw).expect("session message is JSON"))
            }
        };
        self.events.lock_recover().push(recorded);
    }
}

pub(crate) struct LoopRun {
    pub(crate) sink: RecordingSink,
    pub(crate) commands: mpsc::Sender<NativeSessionCommand>,
    registry: NativeSessionRegistry,
    session_id: String,
    done: Receiver<()>,
}

impl LoopRun {
    pub(crate) fn send(&self, command: NativeSessionCommand) {
        self.commands
            .send(command)
            .expect("loop should still be receiving commands");
    }

    /// Wait for the loop thread to return. Panics (fails the test) on a hang.
    pub(crate) fn finish(&self) {
        self.done
            .recv_timeout(LOOP_TIME_LIMIT)
            .expect("session loop did not return within the time limit");
    }
}

fn next_session_id(label: &str) -> String {
    format!(
        "loop-test-{label}-{}-{}",
        std::process::id(),
        SESSION_SEQ.fetch_add(1, Ordering::Relaxed)
    )
}

fn new_state() -> Arc<Mutex<NativeSessionState>> {
    Arc::new(Mutex::new(NativeSessionState {
        buffered_messages: Vec::new(),
        connection_state: "connecting".to_string(),
        stream_id: Some("stream-1".to_string()),
    }))
}

/// Registers the session the way `create_native_session` does, so the test
/// can check the loop removes it on the way out.
fn register(registry: &NativeSessionRegistry, session_id: &str, host: &BackendHostConnection) {
    let (command_sender, _receiver) = channel(NATIVE_SESSION_COMMAND_CHANNEL_CAPACITY);
    insert_native_session(
        registry,
        session_id,
        NativeSessionHandle {
            command_sender,
            host: host.clone(),
            state: new_state(),
        },
    );
}

fn local_host(protocol: &str) -> BackendHostConnection {
    BackendHostConnection {
        agent_forwarding: false,
        auth_method: "none".to_string(),
        environment: None,
        host_key_policy: None,
        hostname: "127.0.0.1".to_string(),
        jump_host: None,
        known_host_algorithm: None,
        known_host_public_key: None,
        password: String::new(),
        passphrase: String::new(),
        port: 22,
        private_key_path: String::new(),
        protocol: protocol.to_string(),
        sftp_root: None,
        username: "loop-test".to_string(),
    }
}

fn shell_spec(
    script: &str,
    exit_label: &str,
    prompt_responses: Vec<PromptResponse>,
    cleanup_dir: Option<PathBuf>,
) -> ExternalCommandSessionSpec {
    let mut command = CommandBuilder::new("/bin/sh");
    command.arg("-c");
    command.arg(script);
    command.cwd(env::temp_dir());
    ExternalCommandSessionSpec {
        command,
        exit_label: exit_label.to_string(),
        prompt_responses,
        cleanup_dir,
    }
}

fn start_external(
    spec: Result<ExternalCommandSessionSpec, String>,
    close_probe: Option<CloseProbe>,
) -> LoopRun {
    let sink = RecordingSink::new(close_probe);
    let registry = NativeSessionRegistry::default();
    let session_id = next_session_id("external");
    let host = local_host("localShell");
    register(&registry, &session_id, &host);
    let (commands, receiver) = mpsc::channel();
    let (done_sender, done) = mpsc::channel();
    {
        let sink = sink.clone();
        let registry = registry.clone();
        let session_id = session_id.clone();
        thread::spawn(move || {
            run_external_command_session_loop_with_spec(
                sink,
                registry,
                NativeForwardRegistry::default(),
                session_id,
                new_state(),
                host,
                receiver,
                move |_, _| spec,
            );
            let _ = done_sender.send(());
        });
    }
    LoopRun {
        sink,
        commands,
        registry,
        session_id,
        done,
    }
}

pub(crate) fn start_jump(host: BackendHostConnection, close_probe: Option<CloseProbe>) -> LoopRun {
    let sink = RecordingSink::new(close_probe);
    let registry = NativeSessionRegistry::default();
    let session_id = next_session_id("jump");
    register(&registry, &session_id, &host);
    let (commands, receiver) = mpsc::channel();
    let (done_sender, done) = mpsc::channel();
    {
        let sink = sink.clone();
        let registry = registry.clone();
        let session_id = session_id.clone();
        thread::spawn(move || {
            run_jump_host_session_loop(
                sink,
                registry,
                NativeForwardRegistry::default(),
                session_id,
                new_state(),
                host,
                receiver,
            );
            let _ = done_sender.send(());
        });
    }
    LoopRun {
        sink,
        commands,
        registry,
        session_id,
        done,
    }
}

pub(crate) fn assert_torn_down(run: &LoopRun) {
    assert!(
        get_native_session(&run.registry, &run.session_id).is_none(),
        "the loop should remove its session from the registry"
    );
    let timeline = run.sink.timeline();
    assert_eq!(
        timeline.iter().rev().take(2).cloned().collect::<Vec<_>>(),
        vec!["close".to_string(), "status:disconnected".to_string()],
        "a session must end with disconnected then close; got {timeline:?}"
    );
}

fn temp_cleanup_dir(label: &str) -> PathBuf {
    let dir = env::temp_dir().join(next_session_id(label));
    fs::create_dir_all(&dir).expect("cleanup dir should be created");
    dir
}

/// A port nothing listens on, so `ssh` fails at connect without any network
/// traffic beyond loopback.
fn closed_loopback_port() -> u16 {
    TcpListener::bind(("127.0.0.1", 0))
        .expect("ephemeral port should bind")
        .local_addr()
        .expect("listener has an address")
        .port()
}

// ---- external-command loop -------------------------------------------------

#[test]
fn external_loop_streams_output_and_ends_cleanly_when_the_command_exits() {
    let run = start_external(
        Ok(shell_spec(
            "printf 'hello-from-loop'",
            "Test command",
            Vec::new(),
            None,
        )),
        None,
    );
    run.finish();

    assert!(run.sink.output().contains("hello-from-loop"));
    assert_eq!(
        run.sink.statuses(),
        vec!["connected".to_string(), "disconnected".to_string()]
    );
    assert!(run.sink.errors().is_empty(), "{:?}", run.sink.errors());
    assert_torn_down(&run);
}

#[test]
fn external_loop_writes_input_to_the_process() {
    let run = start_external(
        Ok(shell_spec(
            "printf 'ready> '; read -r line; printf 'got:%s:end' \"$line\"",
            "Test command",
            Vec::new(),
            None,
        )),
        None,
    );
    run.sink.wait_for_output("ready> ");
    run.send(NativeSessionCommand::Input("typed-input\n".to_string()));
    run.finish();

    assert!(
        run.sink.output().contains("got:typed-input:end"),
        "{:?}",
        run.sink.output()
    );
    assert_torn_down(&run);
}

#[test]
fn external_loop_applies_resize_to_the_pty() {
    let run = start_external(
        Ok(shell_spec(
            "printf 'ready> '; read -r _; printf 'size:%s:end' \"$(stty size)\"",
            "Test command",
            Vec::new(),
            None,
        )),
        None,
    );
    run.sink.wait_for_output("ready> ");
    run.send(NativeSessionCommand::Resize {
        cols: 101,
        rows: 37,
    });
    run.send(NativeSessionCommand::Input("\n".to_string()));
    run.finish();

    assert!(
        run.sink.output().contains("size:37 101:end"),
        "{:?}",
        run.sink.output()
    );
    assert_torn_down(&run);
}

#[test]
fn external_loop_close_command_stops_a_running_process() {
    let run = start_external(
        Ok(shell_spec(
            "printf 'ready> '; sleep 30",
            "Test command",
            Vec::new(),
            None,
        )),
        None,
    );
    run.sink.wait_for_output("ready> ");
    run.send(NativeSessionCommand::Close);
    run.finish();

    assert!(run.sink.errors().is_empty(), "{:?}", run.sink.errors());
    assert_torn_down(&run);
}

#[test]
fn external_loop_reports_a_failed_exit_with_the_spec_exit_label() {
    let run = start_external(
        Ok(shell_spec("exit 3", "Test command", Vec::new(), None)),
        None,
    );
    run.finish();

    let errors = run.sink.errors();
    assert_eq!(errors.len(), 1, "{errors:?}");
    assert!(
        errors[0].starts_with("Test command exited with status"),
        "{errors:?}"
    );
    assert_eq!(
        run.sink.statuses(),
        vec![
            "connected".to_string(),
            "error".to_string(),
            "disconnected".to_string()
        ]
    );
    assert_torn_down(&run);
}

#[test]
fn external_loop_reports_a_spec_failure_without_starting() {
    let run = start_external(Err("spec refused".to_string()), None);
    run.finish();

    assert_eq!(run.sink.errors(), vec!["spec refused".to_string()]);
    assert_eq!(
        run.sink.statuses(),
        vec!["error".to_string(), "disconnected".to_string()]
    );
    assert_torn_down(&run);
}

#[test]
fn external_loop_without_prompt_responses_does_not_answer_password_prompts() {
    // Local reader: the prompt goes unanswered until the test types a reply.
    let run = start_external(
        Ok(shell_spec(
            "printf 'Password: '; read -r line; printf 'got:%s:end' \"$line\"",
            "Test command",
            Vec::new(),
            None,
        )),
        None,
    );
    run.sink.wait_for_output("Password: ");
    // Give an answering reader time to (wrongly) answer before the test does.
    thread::sleep(Duration::from_millis(300));
    run.send(NativeSessionCommand::Input("from-user\n".to_string()));
    run.finish();

    assert!(
        run.sink.output().contains("got:from-user:end"),
        "{:?}",
        run.sink.output()
    );
}

#[test]
fn external_loop_with_prompt_responses_answers_password_prompts() {
    // Jump reader: the loop answers the prompt itself.
    let run = start_external(
        Ok(shell_spec(
            "printf 'Password: '; read -r line; printf 'got:%s:end' \"$line\"",
            "Test command",
            vec![PromptResponse {
                kind: PromptResponseKind::Password,
                value: "from-loop".to_string(),
            }],
            None,
        )),
        None,
    );
    run.finish();

    assert!(
        run.sink.output().contains("got:from-loop:end"),
        "{:?}",
        run.sink.output()
    );
    assert_torn_down(&run);
}

#[test]
fn external_loop_removes_its_cleanup_dir_before_the_close_event() {
    let cleanup_dir = temp_cleanup_dir("external-cleanup");
    let probe_dir = cleanup_dir.clone();
    let run = start_external(
        Ok(shell_spec(
            "printf done",
            "Test command",
            Vec::new(),
            Some(cleanup_dir.clone()),
        )),
        Some(Arc::new(move || probe_dir.exists())),
    );
    run.finish();

    assert_eq!(
        *run.sink.close_probe_result.lock_recover(),
        Some(false),
        "the external loop removes cleanup_dir before it sends close"
    );
    assert!(!cleanup_dir.exists());
    assert_torn_down(&run);
}

// ---- jump-host loop --------------------------------------------------------

/// Both hops are pinned (with a placeholder key) so the config builder does not
/// consult the durable host-key store, which only Tauri setup publishes. The
/// key is never checked: nothing listens on either port.
fn pinned(mut host: BackendHostConnection) -> BackendHostConnection {
    host.known_host_algorithm = Some("ssh-ed25519".to_string());
    host.known_host_public_key = Some("AAAATEST".to_string());
    host
}

fn unreachable_jump_host(target_port: u16, jump_port: u16) -> BackendHostConnection {
    let mut jump = local_host("ssh");
    jump.port = u32::from(jump_port);
    jump.username = "loop-test-jump".to_string();
    let mut target = local_host("ssh");
    target.port = u32::from(target_port);
    target.jump_host = Some(Box::new(pinned(jump)));
    pinned(target)
}

/// The jump loop's session directory has a random name. Its `ssh_config`
/// names the unique closed port, which identifies the directory on disk.
fn jump_session_dir_exists(target_port: u16) -> bool {
    let Ok(root) = native_ssh_session_root() else {
        return false;
    };
    let Ok(entries) = fs::read_dir(root) else {
        return false;
    };
    let needle = format!("Port {target_port}\n");
    entries.flatten().any(|entry| {
        let name = entry.file_name();
        name.to_string_lossy().starts_with(NATIVE_SSH_DIR_PREFIX)
            && fs::read_to_string(entry.path().join("ssh_config"))
                .map(|config| config.contains(&needle))
                .unwrap_or(false)
    })
}

#[test]
fn jump_loop_reports_a_failed_ssh_and_removes_its_dir_after_the_close_event() {
    let target_port = closed_loopback_port();
    let jump_port = closed_loopback_port();
    let run = start_jump(
        unreachable_jump_host(target_port, jump_port),
        Some(Arc::new(move || jump_session_dir_exists(target_port))),
    );
    run.finish();

    let errors = run.sink.errors();
    assert!(
        errors
            .iter()
            .any(|error| error.starts_with("SSH session exited with status")),
        "{errors:?}"
    );
    assert_eq!(
        run.sink.statuses().first().map(String::as_str),
        Some("connected"),
        "the jump loop reports connected once ssh is spawned"
    );
    assert_eq!(
        *run.sink.close_probe_result.lock_recover(),
        Some(true),
        "the jump loop removes its session dir only after it sends close"
    );
    assert!(!jump_session_dir_exists(target_port));
    assert_torn_down(&run);
}

#[test]
fn jump_loop_close_command_ends_the_session() {
    // ssh may still be connecting or already failed; either way Close must
    // end the loop within the time limit and tear down in order.
    let target_port = closed_loopback_port();
    let jump_port = closed_loopback_port();
    let run = start_jump(unreachable_jump_host(target_port, jump_port), None);
    // The loop may already have ended on its own; a refused send is fine.
    let _ = run.commands.send(NativeSessionCommand::Close);
    run.finish();

    assert_torn_down(&run);
    assert!(!jump_session_dir_exists(target_port));
}
