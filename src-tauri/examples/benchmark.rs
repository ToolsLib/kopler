use kopler_lib::store::{Export, Item, Kind, Project, Query, Store};
use std::{path::PathBuf, time::Instant};
use uuid::Uuid;

fn main() {
    let directory = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .expect("Pass a dedicated benchmark data directory");
    let mut store = Store::open(&directory).expect("open benchmark database");
    if store.export().unwrap().items.is_empty() {
        let timestamp = "2026-11-13T00:00:00.000Z".to_string();
        let projects: Vec<_> = (0..20)
            .map(|i| Project {
                id: Uuid::new_v4().to_string(),
                name: format!("Project {i:02}"),
                created_at: timestamp.clone(),
            })
            .collect();
        let items: Vec<_> = (0..10_000)
            .map(|i| {
                let prefix = format!("Item {i:05} reference-{} Straße useful prompt\n", i % 30);
                Item {
                    id: Uuid::new_v4().to_string(),
                    project_id: Some(projects[i % 20].id.clone()),
                    kind: if i % 3 == 0 { Kind::Task } else { Kind::Note },
                    body: format!("{prefix}{}", "x".repeat(1024 - prefix.len())),
                    completed_at: None,
                    created_at: timestamp.clone(),
                    updated_at: timestamp.clone(),
                    images: Vec::new(),
                }
            })
            .collect();
        store
            .import(Export {
                format_version: 1,
                projects,
                items,
                images: Vec::new(),
            })
            .expect("seed data atomically");
    }
    let mut times = Vec::new();
    for i in 0..30 {
        let query = Query {
            project_id: None,
            all_projects: true,
            filter: "all".into(),
            search: format!("reference-{i}"),
            offset: 0,
        };
        let start = Instant::now();
        let page = store.list(&query).unwrap();
        assert!(page.total > 0);
        times.push(start.elapsed().as_secs_f64() * 1000.0);
    }
    times.sort_by(f64::total_cmp);
    println!(
        "{}",
        serde_json::json!({"items":10000,"projects":20,"averageBodyBytes":1024,"queries":30,"storageSearchP50Ms":times[14],"storageSearchP95Ms":times[28],"storageSearchMaxMs":times[29],"note":"Storage query only; UI debounce, IPC, and rendering are additional."})
    );
}
