-- User templates are independent of exercise defaults and recorded days.
CREATE TABLE param_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  params TEXT NOT NULL
);
