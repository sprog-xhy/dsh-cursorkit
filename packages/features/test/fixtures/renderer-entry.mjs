/** Fixture renderer module for the ext-host runtime test. */
export default function renderTool(call) {
  return `render:${call.name}`;
}
