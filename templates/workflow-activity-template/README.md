# Workflow Activity Template

This sample bundle shows the recommended structure for a custom workflow activity in UserTasks.

What to do:

1. Open `workflow-activity.js`.
2. Adjust the declared inputs and outputs in `manifest.json`.
3. Paste the source code and manifest into Extensibility > Workflow Activities.
4. Set the activity to `active` when it is ready to appear in the workflow builder.

Runtime contract:

- Your source must expose one of: `run`, `execute`, `handler`, `main`, `module.exports`, or `module.exports.default`.
- The function receives three arguments: `inputs`, `context`, and `helpers`.
- Return either:
  - `{ outputs: { ... } }`
  - or a plain object of output values.

Available runtime values:

- `inputs`: resolved values mapped from the workflow node.
- `context`: tenant, run, task, variables, and node context.
- `helpers.resolveExpression(expr)`: resolve a workflow expression.
- `helpers.getVariable(name)`: read a workflow variable.
- `helpers.setVariable(name, value)`: write a workflow variable.
- `helpers.log(message, metadata?, level?)`: add an activity log entry.
- `helpers.uuid()`: generate a UUID.
- `helpers.now()`: current ISO timestamp.

Recommended conventions:

- Keep outputs deterministic and JSON-serializable.
- Validate required inputs early.
- Use typed manifest definitions so the builder can generate clear input mappings.
- Avoid external network calls inside the activity unless you control the runtime expectations.
