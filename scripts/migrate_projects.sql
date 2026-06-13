CREATE TABLE IF NOT EXISTS projects (
    project_id VARCHAR(12) NOT NULL PRIMARY KEY,
    client_id BIGINT NOT NULL,
    title VARCHAR(200) NOT NULL,
    due_at DATETIME NULL,
    memo TEXT NULL,
    priority VARCHAR(20) NOT NULL DEFAULT 'normal',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_projects_client (client_id),
    KEY idx_projects_due (due_at),
    CONSTRAINT fk_projects_client FOREIGN KEY (client_id) REFERENCES clients (id)
);

ALTER TABLE jobs ADD COLUMN project_id VARCHAR(12) NULL;
ALTER TABLE jobs ADD KEY idx_jobs_project (project_id);
ALTER TABLE jobs ADD CONSTRAINT fk_jobs_project FOREIGN KEY (project_id) REFERENCES projects (project_id);
