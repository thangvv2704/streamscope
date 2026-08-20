//! StreamScope — the streaming client developers actually enjoy using.
//! Tauri host: registers the connector commands and shared connection state.

mod commands;
mod connector;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::test_connection,
            commands::connect,
            commands::disconnect,
            commands::list_streams,
            commands::describe_stream,
            commands::stream_counts,
            commands::read_messages,
            commands::produce,
            commands::list_consumer_groups,
            commands::group_offsets,
            commands::reset_group_offset,
            commands::create_stream,
            commands::delete_stream,
            commands::set_stream_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
