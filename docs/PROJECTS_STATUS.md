# Projects Feature Status

## Overview
The "Projects" feature (formerly "Valleys") allows users to save their current writing session (editor content + context) to the cloud and restore it later. This acts as a persistent save system.

## Status: ACTIVE & RENAMED
- **Terminology**: The feature has been renamed from "Valleys" to "Projects" throughout the frontend and API.
- **Database**: The Supabase table currently remains `valleys` to avoid migration downtime, but the application code refers to it as `projects`.

## Key Components

### 1. Database Schema (Supabase)
- **Table**: `valleys` (Internal name), `projects` (Application concept)
  - `id`: UUID (Primary Key)
  - `user_id`: UUID (Foreign Key to `auth.users`)
  - `title`: Text (Name of the project)
  - `emoji`: Text (Icon/Emoji for the project)
  - `text`: Text (The editor content)
  - `rules`: Text (Saved rules context)
  - `writing_style`: Text (Saved writing style context)
  - `files`: JSONB (Metadata about attached files + extracted content)
  - `created_at`: Timestamp
  - `updated_at`: Timestamp

### 2. API Endpoint
- **Path**: `/api/projects.js` (Formerly `api/valleys.js`)
- **Methods**:
  - `GET`: List all projects for authenticated user.
  - `GET ?id={id}`: Get specific project details.
  - `POST`: Create a new project or update existing one (if `id` provided).
  - `DELETE`: Delete a project.

### 3. Frontend Logic
- **Manager**: `ProjectsManager` (in `public/app.js`) handles all logic.
  - `saveProject(force)`: Saves current state. Auto-saves periodically.
  - `loadProject(id)`: Loads state into editor and context manager.
  - `newProject()`: Clears editor for a new session.
  - `deleteProject(id)`: Deletes a project.
- **UI**:
  - **Dashboard**: Lists projects in a grid view (`DashboardManager`).
  - **Sidebar**: Lists projects for quick access (if sidebar enabled).
  - **Editor Header**: Shows current project title and emoji.

## Features
- **Unlimited Projects**: All authenticated users can create unlimited projects.
- **Auto-save**: Changes are auto-saved to the active project.
- **Context Preservation**: Rules, Writing Style, and Files are saved/restored with the project.
- **Emoji Customization**: Users can pick an emoji for each project.
- **Renaming**: Inline renaming of projects.

## Recent Changes
- Renamed "Valleys" to "Projects".
- Removed tier-based limits (all users get unlimited projects).
- Simplified UI integration.
