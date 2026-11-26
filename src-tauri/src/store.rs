use crate::images::{self, ImageData, ImageRef, PreparedImage};
use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use unicode_casefold::UnicodeCaseFold;
use uuid::Uuid;

pub type Result<T> = std::result::Result<T, String>;
const SCHEMA_VERSION: i64 = 2;
const MAX_BODY: usize = 256 * 1024;
const MAX_IMPORT_RECORDS: usize = 100_000;

fn db_error(error: rusqlite::Error) -> String {
    format!("Local database operation failed: {error}")
}
fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
fn fold(text: &str) -> String {
    text.case_fold().collect()
}
fn validate_id(id: &str) -> Result<()> {
    if !Uuid::parse_str(id).is_ok_and(|value| value.to_string() == id) {
        return Err("Invalid record ID.".into());
    }
    Ok(())
}
fn validate_time(value: &str) -> Result<()> {
    let parsed = chrono::DateTime::parse_from_rfc3339(value).map_err(|_| "Invalid timestamp.")?;
    if parsed
        .with_timezone(&Utc)
        .to_rfc3339_opts(SecondsFormat::Millis, true)
        != value
    {
        return Err("Timestamps must use UTC with millisecond precision.".into());
    }
    Ok(())
}
pub(crate) fn validate_body(body: &str) -> Result<()> {
    if body.len() > MAX_BODY {
        return Err("An item can contain at most 256 KiB of text.".into());
    }
    Ok(())
}
fn validate_images(images: &[ImageRef]) -> Result<()> {
    if images.len() > images::MAX_IMAGES {
        return Err("Keep at most 8 images in one item.".into());
    }
    let mut ids = HashSet::new();
    for image in images {
        validate_id(&image.id)?;
        images::check_dimensions(image.width, image.height)?;
        if !ids.insert(&image.id) {
            return Err("An image is attached more than once.".into());
        }
    }
    Ok(())
}
fn validate_content(body: &str, images: &[ImageRef]) -> Result<()> {
    validate_body(body)?;
    validate_images(images)?;
    if body.trim().is_empty() && images.is_empty() {
        return Err("Write something or paste an image before saving.".into());
    }
    Ok(())
}
fn validate_name(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err("Use a project name between 1 and 80 characters.".into());
    }
    if fold(name) == "inbox" {
        return Err("Inbox is reserved for unassigned items.".into());
    }
    Ok(name.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Note,
    Task,
}
impl Kind {
    fn as_str(&self) -> &str {
        match self {
            Self::Note => "note",
            Self::Task => "task",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Item {
    pub id: String,
    pub project_id: Option<String>,
    pub kind: Kind,
    pub body: String,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<ImageRef>,
}
impl Item {
    fn validate(&self) -> Result<()> {
        validate_id(&self.id)?;
        if let Some(id) = &self.project_id {
            validate_id(id)?;
        }
        validate_content(&self.body, &self.images)?;
        validate_time(&self.created_at)?;
        validate_time(&self.updated_at)?;
        if self.updated_at < self.created_at {
            return Err("An update cannot precede creation.".into());
        }
        if let Some(time) = &self.completed_at {
            if self.kind != Kind::Task {
                return Err("Only tasks can be completed.".into());
            }
            validate_time(time)?;
            if time < &self.created_at || time > &self.updated_at {
                return Err("Invalid task completion time.".into());
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Draft {
    pub body: String,
    pub kind: Kind,
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<ImageRef>,
}
impl Default for Draft {
    fn default() -> Self {
        Self {
            body: String::new(),
            kind: Kind::Note,
            project_id: None,
            images: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ThemePreference {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preferences {
    pub shortcut: String,
    pub project_id: Option<String>,
    pub filter: String,
    #[serde(default)]
    pub theme: ThemePreference,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            shortcut: if cfg!(target_os = "macos") {
                "Command+Shift+Space"
            } else {
                "Ctrl+Shift+Space"
            }
            .into(),
            project_id: None,
            filter: "all".into(),
            theme: ThemePreference::System,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Export {
    pub format_version: u32,
    pub projects: Vec<Project>,
    pub items: Vec<Item>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<ImageData>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub projects: Vec<Project>,
    pub draft: Draft,
    pub preferences: Preferences,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub items: Vec<Item>,
    pub total: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Query {
    pub project_id: Option<String>,
    pub all_projects: bool,
    pub filter: String,
    pub search: String,
    pub offset: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemInput {
    pub body: String,
    pub kind: Kind,
    pub project_id: Option<String>,
    #[serde(default)]
    pub images: Vec<ImageRef>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub imported: usize,
    pub skipped: usize,
}

struct Undo {
    item: Item,
    until: Instant,
}
pub struct Store {
    conn: Connection,
    undo: HashMap<String, Undo>,
    pub directory: PathBuf,
}

fn row_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<Item> {
    let kind: String = row.get(2)?;
    Ok(Item {
        id: row.get(0)?,
        project_id: row.get(1)?,
        kind: if kind == "task" {
            Kind::Task
        } else {
            Kind::Note
        },
        body: row.get(3)?,
        completed_at: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        images: serde_json::from_str(&row.get::<_, String>(7)?).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                7,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?,
    })
}
const ITEM_COLUMNS: &str =
    "id, project_id, kind, body, completed_at, created_at, updated_at, images";

impl Store {
    pub fn open(directory: &Path) -> Result<Self> {
        std::fs::create_dir_all(directory)
            .map_err(|_| "Could not create the local data directory.")?;
        let path = directory.join("kopler.sqlite3");
        let existing = path.metadata().map(|m| m.len() > 0).unwrap_or(false);
        let mut conn = Connection::open(&path).map_err(db_error)?;
        conn.busy_timeout(Duration::from_secs(5))
            .map_err(db_error)?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(db_error)?;
        let version: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(db_error)?;
        if version > SCHEMA_VERSION {
            return Err("This database was created by a newer Kopler version. Install that version; your data has not been changed.".into());
        }
        if version < SCHEMA_VERSION {
            if existing {
                let backup = directory.join(format!(
                    "kopler.pre-v{SCHEMA_VERSION}.{}.sqlite3",
                    Uuid::new_v4()
                ));
                conn.backup("main", &backup, None).map_err(|_| {
                    "Could not create a migration backup. The original database is preserved."
                })?;
            }
            let tx = conn.transaction().map_err(db_error)?;
            if version == 0 {
                tx.execute_batch("
                CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE CHECK(name_key != 'inbox'), created_at TEXT NOT NULL);
                CREATE TABLE items (
                    id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
                    kind TEXT NOT NULL CHECK(kind IN ('note','task')), body TEXT NOT NULL CHECK(length(trim(body)) > 0), search_body TEXT NOT NULL,
                    completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    CHECK(kind = 'task' OR completed_at IS NULL), CHECK(updated_at >= created_at),
                    CHECK(completed_at IS NULL OR (completed_at >= created_at AND completed_at <= updated_at))
                );
                CREATE INDEX items_project_order ON items(project_id, created_at DESC, id DESC);
                CREATE INDEX items_order ON items(created_at DESC, id DESC);
                CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                PRAGMA user_version = 1;
            ").map_err(|e| format!("Database migration failed; the original database and any backup are preserved. {e}"))?;
            }
            if version < 2 {
                tx.execute_batch("
                CREATE TABLE images (id TEXT PRIMARY KEY, png BLOB NOT NULL, thumbnail BLOB NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL);
                CREATE TABLE items_v2 (
                    id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
                    kind TEXT NOT NULL CHECK(kind IN ('note','task')), body TEXT NOT NULL, search_body TEXT NOT NULL,
                    completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    images TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(images) AND json_type(images) = 'array'),
                    CHECK(length(trim(body)) > 0 OR json_array_length(images) > 0),
                    CHECK(kind = 'task' OR completed_at IS NULL), CHECK(updated_at >= created_at),
                    CHECK(completed_at IS NULL OR (completed_at >= created_at AND completed_at <= updated_at))
                );
                INSERT INTO items_v2(id,project_id,kind,body,search_body,completed_at,created_at,updated_at)
                    SELECT id,project_id,kind,body,search_body,completed_at,created_at,updated_at FROM items;
                DROP TABLE items;
                ALTER TABLE items_v2 RENAME TO items;
                CREATE INDEX items_project_order ON items(project_id, created_at DESC, id DESC);
                CREATE INDEX items_order ON items(created_at DESC, id DESC);
                PRAGMA user_version = 2;
            ").map_err(|e| format!("Database migration failed; the original database and any backup are preserved. {e}"))?;
            }
            tx.commit().map_err(db_error)?;
        }
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(db_error)?;
        conn.pragma_update(None, "synchronous", "FULL")
            .map_err(db_error)?;
        // Let the OS share file-backed pages instead of repeatedly copying search scans
        // through SQLite's private page cache. This does not reserve 64 MiB up front.
        conn.pragma_update(None, "mmap_size", 64_i64 * 1024 * 1024)
            .map_err(db_error)?;
        let store = Self {
            conn,
            undo: HashMap::new(),
            directory: directory.to_path_buf(),
        };
        store.prune_images()?;
        Ok(store)
    }

    fn get_setting<T: for<'de> Deserialize<'de> + Default>(&self, key: &str) -> Result<T> {
        let value: Option<String> = self
            .conn
            .query_row("SELECT value FROM settings WHERE key=?1", [key], |r| {
                r.get(0)
            })
            .optional()
            .map_err(db_error)?;
        match value {
            Some(value) => serde_json::from_str(&value)
                .map_err(|_| "A saved preference is invalid. Your items are intact.".into()),
            None => Ok(T::default()),
        }
    }
    fn put_setting<T: Serialize>(&self, key: &str, value: &T) -> Result<()> {
        let json = serde_json::to_string(value).map_err(|_| "Could not encode a preference.")?;
        self.conn.execute("INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key, json]).map_err(db_error)?;
        Ok(())
    }
    fn check_project(&self, project_id: &Option<String>) -> Result<()> {
        if let Some(id) = project_id {
            let exists: bool = self
                .conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM projects WHERE id=?1)",
                    [id],
                    |r| r.get(0),
                )
                .map_err(db_error)?;
            if !exists {
                return Err(
                    "That project no longer exists. Choose Inbox or another project.".into(),
                );
            }
        }
        Ok(())
    }
    pub fn bootstrap(&self) -> Result<Bootstrap> {
        Ok(Bootstrap {
            projects: self.projects()?,
            draft: self.get_setting("draft")?,
            preferences: self.preferences()?,
        })
    }
    pub fn preferences(&self) -> Result<Preferences> {
        self.get_setting("preferences")
    }
    pub fn auto_update_check(&self) -> Result<bool> {
        Ok(self
            .get_setting::<Option<bool>>("auto_update_check")?
            .unwrap_or(true))
    }
    pub fn save_auto_update_check(&self, enabled: bool) -> Result<()> {
        self.put_setting("auto_update_check", &enabled)
    }
    pub fn save_preferences(&self, value: &Preferences) -> Result<()> {
        if !["active", "completed", "all"].contains(&value.filter.as_str()) {
            return Err("Invalid item filter.".into());
        }
        if value.shortcut.len() > 100 {
            return Err("Invalid shortcut.".into());
        }
        self.check_project(&value.project_id)?;
        self.put_setting("preferences", value)
    }
    pub fn save_draft(&self, value: &Draft) -> Result<()> {
        if value.body.len() > MAX_BODY {
            return Err("A draft can contain at most 256 KiB of text.".into());
        }
        self.check_project(&value.project_id)?;
        validate_images(&value.images)?;
        self.check_images(&value.images)?;
        self.put_setting("draft", value)
    }
    pub fn projects(&self) -> Result<Vec<Project>> {
        self.conn
            .prepare("SELECT id,name,created_at FROM projects ORDER BY name_key,id")
            .map_err(db_error)?
            .query_map([], |r| {
                Ok(Project {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    created_at: r.get(2)?,
                })
            })
            .map_err(db_error)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(db_error)
    }
    pub fn create_project(&self, name: &str) -> Result<Project> {
        let name = validate_name(name)?;
        let project = Project {
            id: Uuid::new_v4().to_string(),
            name,
            created_at: now(),
        };
        self.conn.execute("INSERT INTO projects(id,name,name_key,created_at) VALUES(?1,?2,?3,?4)", params![project.id,project.name,fold(&project.name),project.created_at])
            .map_err(|_| "Could not create the project. Check that its name is unique and storage is writable.")?;
        Ok(project)
    }
    pub fn rename_project(&self, id: &str, name: &str) -> Result<()> {
        let name = validate_name(name)?;
        let changed = self.conn.execute("UPDATE projects SET name=?1,name_key=?2 WHERE id=?3", params![name,fold(&name),id])
            .map_err(|_| "Could not rename the project. Check that its name is unique and storage is writable.")?;
        if changed == 0 {
            return Err("Project not found.".into());
        }
        Ok(())
    }
    pub fn delete_project(&mut self, id: &str) -> Result<()> {
        let mut draft: Draft = self.get_setting("draft")?;
        let mut preferences = self.preferences()?;
        if draft.project_id.as_deref() == Some(id) {
            draft.project_id = None;
        }
        if preferences.project_id.as_deref() == Some(id) {
            preferences.project_id = None;
        }
        let tx = self.conn.transaction().map_err(db_error)?;
        if tx
            .execute("DELETE FROM projects WHERE id=?1", [id])
            .map_err(db_error)?
            == 0
        {
            return Err("Project not found.".into());
        }
        for (key, value) in [
            ("draft", serde_json::to_string(&draft)),
            ("preferences", serde_json::to_string(&preferences)),
        ] {
            tx.execute("INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key,value.map_err(|_| "Could not encode settings.")?]).map_err(db_error)?;
        }
        tx.commit().map_err(db_error)?;
        for value in self.undo.values_mut() {
            if value.item.project_id.as_deref() == Some(id) {
                value.item.project_id = None;
            }
        }
        Ok(())
    }
    pub fn list(&self, query: &Query) -> Result<Page> {
        if !["active", "completed", "all"].contains(&query.filter.as_str()) {
            return Err("Invalid item filter.".into());
        }
        if query.search.len() > 4096 {
            return Err("Search is too long.".into());
        }
        let filter = match query.filter.as_str() {
            "completed" => "completed_at IS NOT NULL",
            "all" => "1=1",
            _ => "completed_at IS NULL",
        };
        let scope = "(?1 OR project_id IS ?2)";
        let search = fold(&query.search);
        let where_clause =
            format!("WHERE {scope} AND {filter} AND (?3='' OR instr(search_body,?3)>0)");
        let total: usize = self
            .conn
            .query_row(
                &format!("SELECT count(*) FROM items {where_clause}"),
                params![query.all_projects, query.project_id, search],
                |r| r.get(0),
            )
            .map_err(db_error)?;
        let mut statement = self.conn.prepare(&format!("SELECT {ITEM_COLUMNS} FROM items {where_clause} ORDER BY created_at DESC,id DESC LIMIT 60 OFFSET ?4")).map_err(db_error)?;
        let items = statement
            .query_map(
                params![
                    query.all_projects,
                    query.project_id,
                    search,
                    query.offset.min(i64::MAX as usize) as i64
                ],
                row_item,
            )
            .map_err(db_error)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(db_error)?;
        Ok(Page { items, total })
    }
    pub fn item(&self, id: &str) -> Result<Item> {
        self.conn
            .query_row(
                &format!("SELECT {ITEM_COLUMNS} FROM items WHERE id=?1"),
                [id],
                row_item,
            )
            .optional()
            .map_err(db_error)?
            .ok_or("Item not found.".into())
    }
    fn insert(conn: &Connection, item: &Item) -> Result<()> {
        conn.execute("INSERT INTO items(id,project_id,kind,body,completed_at,created_at,updated_at,search_body,images) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![item.id,item.project_id,item.kind.as_str(),item.body,item.completed_at,item.created_at,item.updated_at,fold(&item.body),serde_json::to_string(&item.images).map_err(|_| "Could not encode image attachments.")?]).map_err(db_error)?;
        Ok(())
    }
    pub fn create_item(&mut self, input: ItemInput) -> Result<Item> {
        validate_content(&input.body, &input.images)?;
        self.check_images(&input.images)?;
        self.check_project(&input.project_id)?;
        let timestamp = now();
        let item = Item {
            id: Uuid::new_v4().to_string(),
            project_id: input.project_id,
            kind: input.kind,
            body: input.body,
            completed_at: None,
            created_at: timestamp.clone(),
            updated_at: timestamp,
            images: input.images,
        };
        let draft = Draft {
            body: String::new(),
            kind: Kind::Note,
            project_id: item.project_id.clone(),
            images: Vec::new(),
        };
        let tx = self.conn.transaction().map_err(db_error)?;
        Self::insert(&tx, &item)?;
        tx.execute("INSERT INTO settings(key,value) VALUES('draft',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [serde_json::to_string(&draft).map_err(|_| "Could not save draft state.")?]).map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        Ok(item)
    }
    pub fn update_item(&self, id: &str, input: ItemInput) -> Result<Item> {
        validate_content(&input.body, &input.images)?;
        self.check_images(&input.images)?;
        self.check_project(&input.project_id)?;
        let mut item = self.item(id)?;
        item.body = input.body;
        item.kind = input.kind;
        item.project_id = input.project_id;
        item.images = input.images;
        item.updated_at = now().max(item.updated_at);
        if item.kind == Kind::Note {
            item.completed_at = None;
        }
        self.conn.execute("UPDATE items SET body=?1,kind=?2,project_id=?3,completed_at=?4,updated_at=?5,search_body=?7,images=?8 WHERE id=?6", params![item.body,item.kind.as_str(),item.project_id,item.completed_at,item.updated_at,item.id,fold(&item.body),serde_json::to_string(&item.images).map_err(|_| "Could not encode image attachments.")?]).map_err(db_error)?;
        Ok(item)
    }
    pub fn complete(&self, id: &str, completed: bool) -> Result<Item> {
        let mut item = self.item(id)?;
        if item.kind != Kind::Task {
            return Err("Only tasks can be completed.".into());
        }
        item.updated_at = now().max(item.updated_at);
        item.completed_at = if completed {
            Some(item.updated_at.clone())
        } else {
            None
        };
        self.conn
            .execute(
                "UPDATE items SET completed_at=?1,updated_at=?2 WHERE id=?3",
                params![item.completed_at, item.updated_at, id],
            )
            .map_err(db_error)?;
        Ok(item)
    }
    pub fn delete_item(&mut self, id: &str) -> Result<String> {
        let item = self.item(id)?;
        self.conn
            .execute("DELETE FROM items WHERE id=?1", [id])
            .map_err(db_error)?;
        self.undo.retain(|_, value| value.until > Instant::now());
        let token = Uuid::new_v4().to_string();
        self.undo.insert(
            token.clone(),
            Undo {
                item,
                until: Instant::now() + Duration::from_secs(10),
            },
        );
        Ok(token)
    }
    pub fn undo_delete(&mut self, token: &str) -> Result<Item> {
        let undo = self.undo.get(token).ok_or("Undo is no longer available.")?;
        if undo.until <= Instant::now() {
            self.undo.remove(token);
            return Err("Undo is no longer available.".into());
        }
        let item = undo.item.clone();
        Self::insert(&self.conn, &item)?;
        self.undo.remove(token);
        Ok(item)
    }
    fn check_images(&self, images: &[ImageRef]) -> Result<()> {
        Self::check_images_in(&self.conn, images)
    }
    fn check_images_in(conn: &Connection, images: &[ImageRef]) -> Result<()> {
        for image in images {
            let dimensions = conn
                .query_row(
                    "SELECT width,height FROM images WHERE id=?1",
                    [&image.id],
                    |row| Ok((row.get::<_, u32>(0)?, row.get::<_, u32>(1)?)),
                )
                .optional()
                .map_err(db_error)?;
            if dimensions != Some((image.width, image.height)) {
                return Err("An attached image is missing or has invalid dimensions.".into());
            }
        }
        Ok(())
    }
    fn prune_images(&self) -> Result<()> {
        let mut keep: HashSet<String> = self
            .get_setting::<Draft>("draft")?
            .images
            .into_iter()
            .map(|image| image.id)
            .collect();
        let mut statement = self
            .conn
            .prepare("SELECT json_extract(value,'$.id') FROM items,json_each(items.images)")
            .map_err(db_error)?;
        for id in statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(db_error)?
        {
            keep.insert(id.map_err(db_error)?);
        }
        for undo in self
            .undo
            .values()
            .filter(|undo| undo.until > Instant::now())
        {
            keep.extend(undo.item.images.iter().map(|image| image.id.clone()));
        }
        let mut statement = self
            .conn
            .prepare("SELECT id FROM images")
            .map_err(db_error)?;
        let ids = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(db_error)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(db_error)?;
        for id in ids {
            if !keep.contains(&id) {
                self.conn
                    .execute("DELETE FROM images WHERE id=?1", [id])
                    .map_err(db_error)?;
            }
        }
        Ok(())
    }
    pub fn put_image(&self, image: PreparedImage) -> Result<ImageRef> {
        Ok(self.put_images(vec![image])?.remove(0))
    }
    pub fn put_images(&self, images: Vec<PreparedImage>) -> Result<Vec<ImageRef>> {
        if images.is_empty() || images.len() > images::MAX_IMAGES {
            return Err("Paste between 1 and 8 images.".into());
        }
        self.prune_images()?;
        let tx = self.conn.unchecked_transaction().map_err(db_error)?;
        let mut references = Vec::new();
        for image in images {
            let reference = ImageRef {
                id: Uuid::new_v4().to_string(),
                width: image.width,
                height: image.height,
            };
            tx.execute(
                "INSERT INTO images(id,png,thumbnail,width,height) VALUES(?1,?2,?3,?4,?5)",
                params![
                    reference.id,
                    image.png,
                    image.thumbnail,
                    image.width,
                    image.height
                ],
            )
            .map_err(db_error)?;
            references.push(reference);
        }
        tx.commit().map_err(db_error)?;
        Ok(references)
    }
    pub fn image_reference(&self, id: &str) -> Result<ImageRef> {
        validate_id(id)?;
        self.conn
            .query_row("SELECT width,height FROM images WHERE id=?1", [id], |row| {
                Ok(ImageRef {
                    id: id.to_string(),
                    width: row.get(0)?,
                    height: row.get(1)?,
                })
            })
            .optional()
            .map_err(db_error)?
            .ok_or("Image not found.".into())
    }
    pub fn image_bytes(&self, id: &str, thumbnail: bool) -> Result<Vec<u8>> {
        validate_id(id)?;
        self.conn
            .query_row(
                if thumbnail {
                    "SELECT thumbnail FROM images WHERE id=?1"
                } else {
                    "SELECT png FROM images WHERE id=?1"
                },
                [id],
                |row| row.get(0),
            )
            .optional()
            .map_err(db_error)?
            .ok_or("Image not found.".into())
    }
    fn all_items(&self) -> Result<Vec<Item>> {
        self.conn
            .prepare(&format!(
                "SELECT {ITEM_COLUMNS} FROM items ORDER BY created_at DESC,id DESC"
            ))
            .map_err(db_error)?
            .query_map([], row_item)
            .map_err(db_error)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(db_error)
    }
    pub fn export(&self) -> Result<Export> {
        let items = self.all_items()?;
        let ids: HashSet<_> = items
            .iter()
            .flat_map(|item| item.images.iter().map(|image| image.id.clone()))
            .collect();
        let mut images = Vec::new();
        for id in ids {
            images.push(ImageData {
                data_url: images::data_url(&self.image_bytes(&id, false)?),
                id,
            });
        }
        images.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(Export {
            format_version: if images.is_empty() { 1 } else { 2 },
            projects: self.projects()?,
            items,
            images,
        })
    }
    pub fn import(&mut self, data: Export) -> Result<ImportReport> {
        if ![1, 2].contains(&data.format_version) {
            return Err("Unsupported export format version.".into());
        }
        if data.items.len() + data.projects.len() + data.images.len() > MAX_IMPORT_RECORDS {
            return Err("Import exceeds 100,000 records.".into());
        }
        if data.format_version == 1
            && (!data.images.is_empty() || data.items.iter().any(|item| !item.images.is_empty()))
        {
            return Err("Image attachments require export format version 2.".into());
        }
        let existing_projects = self.projects()?;
        let existing_items = self.all_items()?;
        let mut project_ids: HashSet<String> =
            existing_projects.iter().map(|p| p.id.clone()).collect();
        let mut ids = HashSet::new();
        let mut prepared_images = Vec::new();
        for image in data.images {
            validate_id(&image.id)?;
            if !ids.insert(image.id.clone()) {
                return Err("Duplicate image ID in import.".into());
            }
            prepared_images.push((image.id, images::from_data_url(&image.data_url)?));
        }
        ids.clear();
        for project in &data.projects {
            validate_id(&project.id)?;
            validate_time(&project.created_at)?;
            if validate_name(&project.name)? != project.name {
                return Err("Project names must be trimmed.".into());
            }
            if !ids.insert(project.id.clone()) {
                return Err("Duplicate project ID in import.".into());
            }
            project_ids.insert(project.id.clone());
        }
        ids.clear();
        for item in &data.items {
            item.validate()?;
            if !ids.insert(item.id.clone()) {
                return Err("Duplicate item ID in import.".into());
            }
            if item
                .project_id
                .as_ref()
                .is_some_and(|id| !project_ids.contains(id))
            {
                return Err("An imported item refers to a missing project.".into());
            }
        }
        let projects: HashMap<_, _> = existing_projects
            .into_iter()
            .map(|p| (p.id.clone(), p))
            .collect();
        let items: HashMap<_, _> = existing_items
            .into_iter()
            .map(|i| (i.id.clone(), i))
            .collect();
        let tx = self.conn.transaction().map_err(db_error)?;
        for (id, image) in prepared_images {
            let old: Option<Vec<u8>> = tx
                .query_row("SELECT png FROM images WHERE id=?1", [&id], |row| {
                    row.get(0)
                })
                .optional()
                .map_err(db_error)?;
            if let Some(old) = old {
                if old != image.png {
                    return Err(
                        "Import conflicts with an existing image. Nothing was imported.".into(),
                    );
                }
            } else {
                tx.execute(
                    "INSERT INTO images(id,png,thumbnail,width,height) VALUES(?1,?2,?3,?4,?5)",
                    params![id, image.png, image.thumbnail, image.width, image.height],
                )
                .map_err(db_error)?;
            }
        }
        let mut report = ImportReport {
            imported: 0,
            skipped: 0,
        };
        for project in data.projects {
            if let Some(old) = projects.get(&project.id) {
                if old != &project {
                    return Err(
                        "Import conflicts with an existing project. Nothing was imported.".into(),
                    );
                }
                report.skipped += 1;
            } else {
                tx.execute(
                    "INSERT INTO projects(id,name,name_key,created_at) VALUES(?1,?2,?3,?4)",
                    params![
                        project.id,
                        project.name,
                        fold(&project.name),
                        project.created_at
                    ],
                )
                .map_err(|_| {
                    "Import has a duplicate project name or storage failed. Nothing was imported."
                })?;
                report.imported += 1;
            }
        }
        for item in data.items {
            Self::check_images_in(&tx, &item.images)?;
            if let Some(old) = items.get(&item.id) {
                if old != &item {
                    return Err(
                        "Import conflicts with an existing item. Nothing was imported.".into(),
                    );
                }
                report.skipped += 1;
            } else {
                Self::insert(&tx, &item)?;
                report.imported += 1;
            }
        }
        tx.commit().map_err(db_error)?;
        Ok(report)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn setup() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let db = Store::open(dir.path()).unwrap();
        (dir, db)
    }
    fn input(body: &str, kind: Kind, project_id: Option<String>) -> ItemInput {
        ItemInput {
            body: body.into(),
            kind,
            project_id,
            images: Vec::new(),
        }
    }
    fn query(filter: &str) -> Query {
        Query {
            project_id: None,
            all_projects: true,
            filter: filter.into(),
            search: String::new(),
            offset: 0,
        }
    }
    #[test]
    fn exact_content_and_draft_survive_restart() {
        let (dir, mut db) = setup();
        let body = "  <script>alert('text')</script>\n**hello**\n\t";
        let item = db.create_item(input(body, Kind::Note, None)).unwrap();
        db.save_draft(&Draft {
            body: "unfinished".into(),
            kind: Kind::Task,
            project_id: None,
            images: Vec::new(),
        })
        .unwrap();
        drop(db);
        let db = Store::open(dir.path()).unwrap();
        assert_eq!(db.item(&item.id).unwrap().body, body);
        assert_eq!(db.bootstrap().unwrap().draft.body, "unfinished");
        assert_eq!(db.bootstrap().unwrap().preferences.filter, "all");
    }
    #[test]
    fn updater_preferences_default_for_legacy_data_and_survive_restart() {
        let (dir, mut db) = setup();
        assert!(db.auto_update_check().unwrap());
        db.put_setting(
            "preferences",
            &serde_json::json!({"shortcut":"Ctrl+Alt+K","projectId":null,"filter":"all"}),
        )
        .unwrap();
        assert!(db.auto_update_check().unwrap());
        db.save_auto_update_check(false).unwrap();
        drop(db);
        db = Store::open(dir.path()).unwrap();
        assert!(!db.auto_update_check().unwrap());
        assert_eq!(db.preferences().unwrap().shortcut, "Ctrl+Alt+K");
        let original: serde_json::Value = db.get_setting("preferences").unwrap();
        assert_eq!(original.as_object().unwrap().len(), 3);
    }
    #[test]
    fn appearance_defaults_for_existing_preferences_and_survives_restart() {
        let (dir, mut db) = setup();
        assert_eq!(db.preferences().unwrap().theme, ThemePreference::System);
        db.put_setting(
            "preferences",
            &serde_json::json!({
                "shortcut": "Ctrl+Alt+K", "projectId": null, "filter": "completed"
            }),
        )
        .unwrap();
        let legacy = db.preferences().unwrap();
        assert_eq!(legacy.theme, ThemePreference::System);
        assert_eq!(legacy.shortcut, "Ctrl+Alt+K");
        assert_eq!(legacy.filter, "completed");
        for theme in [
            ThemePreference::Dark,
            ThemePreference::Light,
            ThemePreference::System,
        ] {
            let mut preferences = db.preferences().unwrap();
            preferences.theme = theme;
            db.save_preferences(&preferences).unwrap();
            drop(db);
            db = Store::open(dir.path()).unwrap();
            assert_eq!(db.preferences().unwrap().theme, theme);
            assert_eq!(db.preferences().unwrap().shortcut, "Ctrl+Alt+K");
        }
        assert!(serde_json::from_str::<ThemePreference>("\"invalid\"").is_err());
    }
    #[test]
    fn creation_and_draft_clear_are_atomic() {
        let (_dir, mut db) = setup();
        db.save_draft(&Draft {
            body: "keep me".into(),
            ..Draft::default()
        })
        .unwrap();
        db.conn.pragma_update(None, "query_only", true).unwrap();
        assert!(db.create_item(input("keep me", Kind::Note, None)).is_err());
        assert_eq!(db.bootstrap().unwrap().draft.body, "keep me");
        assert_eq!(db.list(&query("all")).unwrap().total, 0);
    }
    #[test]
    fn project_deletion_rehomes_items_and_drafts() {
        let (_dir, mut db) = setup();
        let p = db.create_project("Work").unwrap();
        let item = db
            .create_item(input("hello", Kind::Task, Some(p.id.clone())))
            .unwrap();
        db.save_draft(&Draft {
            body: "draft".into(),
            kind: Kind::Note,
            project_id: Some(p.id.clone()),
            images: Vec::new(),
        })
        .unwrap();
        db.delete_project(&p.id).unwrap();
        assert!(db.item(&item.id).unwrap().project_id.is_none());
        assert!(db.bootstrap().unwrap().draft.project_id.is_none());
    }
    #[test]
    fn unicode_names_and_search_case_fold() {
        let (_dir, mut db) = setup();
        db.create_project("Straße").unwrap();
        assert!(db.create_project("  STRASSE  ").is_err());
        assert!(db.create_project(" INBOX ").is_err());
        db.create_item(input("Straße ÉLÈVE", Kind::Note, None))
            .unwrap();
        let mut q = query("all");
        q.search = "STRASSE élève".into();
        assert_eq!(db.list(&q).unwrap().total, 1);
    }
    #[test]
    fn filters_scope_and_completion_are_independent() {
        let (_dir, mut db) = setup();
        let p = db.create_project("Work").unwrap();
        db.create_item(input("note", Kind::Note, None)).unwrap();
        let task = db
            .create_item(input("task", Kind::Task, Some(p.id.clone())))
            .unwrap();
        db.complete(&task.id, true).unwrap();
        assert_eq!(db.list(&query("active")).unwrap().total, 1);
        assert_eq!(db.list(&query("completed")).unwrap().total, 1);
        let mut q = query("all");
        q.all_projects = false;
        assert_eq!(db.list(&q).unwrap().total, 1);
        q.project_id = Some(p.id);
        assert_eq!(db.list(&q).unwrap().total, 1);
        db.complete(&task.id, false).unwrap();
        assert_eq!(db.list(&query("active")).unwrap().total, 2);
    }
    #[test]
    fn deletion_undo_expires_and_survives_project_deletion() {
        let (_dir, mut db) = setup();
        let p = db.create_project("Work").unwrap();
        let item = db
            .create_item(input("hello", Kind::Note, Some(p.id.clone())))
            .unwrap();
        let token = db.delete_item(&item.id).unwrap();
        db.delete_project(&p.id).unwrap();
        assert!(db.undo_delete(&token).unwrap().project_id.is_none());
        let token = db.delete_item(&item.id).unwrap();
        db.undo.get_mut(&token).unwrap().until = Instant::now();
        assert!(db.undo_delete(&token).is_err());
    }
    #[test]
    fn import_roundtrip_skips_duplicates_and_rolls_back_conflicts() {
        let (_dir, mut db) = setup();
        let p = db.create_project("Work").unwrap();
        db.create_item(input("exact\ntext", Kind::Task, Some(p.id)))
            .unwrap();
        let data = db.export().unwrap();
        let (_other, mut target) = setup();
        assert_eq!(target.import(data.clone()).unwrap().imported, 2);
        assert_eq!(target.import(data.clone()).unwrap().skipped, 2);
        let mut conflict = data;
        conflict.items[0].body = "changed".into();
        conflict.projects.push(Project {
            id: Uuid::new_v4().to_string(),
            name: "Must roll back".into(),
            created_at: now(),
        });
        assert!(target.import(conflict).is_err());
        assert_eq!(target.projects().unwrap().len(), 1);
    }
    #[test]
    fn malformed_import_cannot_break_invariants() {
        let (_dir, mut db) = setup();
        db.create_item(input("note", Kind::Note, None)).unwrap();
        let mut data = db.export().unwrap();
        data.items[0].completed_at = Some(now());
        assert!(db.import(data).is_err());
        assert!(db.create_item(input(" ", Kind::Note, None)).is_err());
        assert!(db
            .create_item(input("hello", Kind::Note, Some(Uuid::new_v4().to_string())))
            .is_err());
    }
    #[test]
    fn image_drafts_items_undo_and_exports_preserve_pixels() {
        let (dir, mut db) = setup();
        let png = images::encode_rgba(2, 2, &[30, 60, 90, 120].repeat(4)).unwrap();
        let image = db.put_image(images::prepare(png.clone()).unwrap()).unwrap();
        assert_eq!(db.image_reference(&image.id).unwrap(), image);
        assert!(db.image_reference("invalid-id").is_err());
        assert!(db.image_reference(&Uuid::new_v4().to_string()).is_err());
        let draft = Draft {
            body: "caption".into(),
            images: vec![image.clone()],
            ..Draft::default()
        };
        db.save_draft(&draft).unwrap();
        drop(db);
        db = Store::open(dir.path()).unwrap();
        assert_eq!(db.bootstrap().unwrap().draft, draft);
        let project = db.create_project("Pictures").unwrap();
        let mut input = input("", Kind::Task, Some(project.id.clone()));
        input.images.push(image.clone());
        let item = db.create_item(input).unwrap();
        assert!(db.bootstrap().unwrap().draft.images.is_empty());
        assert!(db.complete(&item.id, true).unwrap().completed_at.is_some());
        let token = db.delete_item(&item.id).unwrap();
        // Collect abandoned images without collecting the active Undo attachment.
        db.put_image(images::prepare(png.clone()).unwrap()).unwrap();
        assert_eq!(db.undo_delete(&token).unwrap().images, vec![image.clone()]);
        db.delete_project(&project.id).unwrap();
        assert!(db.item(&item.id).unwrap().project_id.is_none());
        let exported = db.export().unwrap();
        assert_eq!(exported.format_version, 2);
        assert_eq!(exported.images.len(), 1);
        assert_eq!(
            images::from_data_url(&exported.images[0].data_url)
                .unwrap()
                .png,
            png
        );
        let (_target_dir, mut target) = setup();
        assert_eq!(target.import(exported.clone()).unwrap().imported, 1);
        assert_eq!(target.import(exported.clone()).unwrap().skipped, 1);
        assert_eq!(target.image_bytes(&image.id, false).unwrap(), png);
        let mut conflict = exported.clone();
        conflict.items[0].body = "conflict".into();
        let new_id = Uuid::new_v4().to_string();
        conflict.images.push(ImageData {
            id: new_id.clone(),
            data_url: images::data_url(&png),
        });
        assert!(target.import(conflict).is_err());
        assert!(target.image_bytes(&new_id, false).is_err());
        let mut missing = exported;
        missing.items[0].images[0].width = 3;
        assert!(target.import(missing).is_err());
        let token = db.delete_item(&item.id).unwrap();
        db.undo.get_mut(&token).unwrap().until = Instant::now();
        drop(db);
        db = Store::open(dir.path()).unwrap();
        assert!(db.image_bytes(&image.id, false).is_err());
    }
    #[test]
    fn failed_image_note_save_keeps_draft_and_rejects_missing_attachments() {
        let (_dir, mut db) = setup();
        let image = db
            .put_image(images::prepare(images::encode_rgba(1, 1, &[1, 2, 3, 4]).unwrap()).unwrap())
            .unwrap();
        let draft = Draft {
            images: vec![image.clone()],
            ..Draft::default()
        };
        db.save_draft(&draft).unwrap();
        let mut image_input = input("", Kind::Note, None);
        image_input.images.push(image.clone());
        db.conn.pragma_update(None, "query_only", true).unwrap();
        assert!(db.create_item(image_input).is_err());
        assert_eq!(db.bootstrap().unwrap().draft, draft);
        assert!(db.image_bytes(&image.id, false).is_ok());
        db.conn.pragma_update(None, "query_only", false).unwrap();
        let mut invalid = input("caption", Kind::Note, None);
        invalid.images.push(ImageRef {
            id: Uuid::new_v4().to_string(),
            width: 1,
            height: 1,
        });
        assert!(db.create_item(invalid).is_err());
    }
    #[test]
    fn version_one_migration_preserves_notes_drafts_and_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("kopler.sqlite3");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,name_key TEXT UNIQUE,created_at TEXT NOT NULL);
            CREATE TABLE items(id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id),kind TEXT,body TEXT CHECK(length(trim(body))>0),search_body TEXT,completed_at TEXT,created_at TEXT,updated_at TEXT);
            CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); PRAGMA user_version=1;").unwrap();
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO items VALUES(?1,NULL,'note','Keep this note','keep this note',NULL,?2,?2)",
            params![id, now()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings VALUES('draft',?1)",
            [r#"{"body":"old draft","kind":"note","projectId":null}"#],
        )
        .unwrap();
        drop(conn);
        let db = Store::open(dir.path()).unwrap();
        assert_eq!(db.item(&id).unwrap().body, "Keep this note");
        assert!(db.item(&id).unwrap().images.is_empty());
        assert_eq!(db.bootstrap().unwrap().draft.body, "old draft");
        assert!(db.bootstrap().unwrap().draft.images.is_empty());
        let backup = std::fs::read_dir(dir.path())
            .unwrap()
            .find_map(|entry| {
                let path = entry.unwrap().path();
                path.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .contains("pre-v2")
                    .then_some(path)
            })
            .unwrap();
        let backup = Connection::open(backup).unwrap();
        assert_eq!(
            backup
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            backup
                .query_row("SELECT body FROM items WHERE id=?1", [id], |row| row
                    .get::<_, String>(0))
                .unwrap(),
            "Keep this note"
        );
    }
    #[test]
    fn migration_failure_preserves_original_and_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("kopler.sqlite3");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE projects(legacy TEXT); INSERT INTO projects VALUES('keep');",
        )
        .unwrap();
        drop(conn);
        assert!(Store::open(dir.path()).is_err());
        let conn = Connection::open(path).unwrap();
        assert_eq!(
            conn.query_row("SELECT legacy FROM projects", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "keep"
        );
        assert!(std::fs::read_dir(dir.path()).unwrap().any(|p| p
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains("pre-v2")));
    }
    #[test]
    fn newer_database_is_not_modified() {
        let (dir, db) = setup();
        db.conn.pragma_update(None, "user_version", 999).unwrap();
        drop(db);
        assert!(Store::open(dir.path()).is_err());
        let conn = Connection::open(dir.path().join("kopler.sqlite3")).unwrap();
        assert_eq!(
            conn.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                .unwrap(),
            999
        );
    }
}
