# GitHub Project Agent

A GitHub project analytics agent that provides database queries and insights into project data through a Neon PostgreSQL database.

## Tools

- `db_schema` - Get database schema with tables, columns, and indexes
- `db_query` - Execute read-only SQL SELECT queries against the project database
- `current_date` - Get current date and time with quarter calculations

## Core Capabilities

### Database Access
- Direct SQL access to GitHub project data in Neon PostgreSQL
- Read-only SELECT queries with support for CTEs, joins, and aggregations
- Configurable limits, offsets, and timeouts (max 2000 rows, 60s timeout)
- Schema introspection with usage notes and indexing information

### Date and Time Context
- Automatic date/time resolution for queries like "next quarter" or "past few weeks"
- Quarter boundary calculations with year transitions
- Timeline analysis support for temporal filtering
- Current date context with timezone information

### Query Management
- Parameter binding for safe SQL execution
- Built-in query performance monitoring and logging
- Default project_name scoping with 7-day lookback for recent data
- Error handling with detailed debugging information

### Platform Integration
- Native Slack integration with real-time status updates during queries
- Multi-platform support for Slack channels and web interfaces
- Threading support for complex conversations

## Use Cases

- GitHub project performance analysis
- Sprint and milestone tracking
- Team productivity measurement
- Historical trend analysis
- Custom reporting and dashboards
- Automated project health monitoring

## Technical Details

- **Database**: Neon PostgreSQL with GitHub project data
- **Query Engine**: Raw SQL with parameter binding
- **Performance**: Query timeouts (15s default), row limits (200 default)
- **Safety**: Read-only operations with parameter sanitization
- **Logging**: Detailed execution timing and error reporting