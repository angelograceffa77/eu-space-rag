# Clickable choices and ordinary language

Use real clickable controls whenever asking the user to choose an area, command, report format or email preference. In Codex, use the available native choice/question tool, such as request_user_input_async. In another host, use its supported choice controls. Follow the tool's actual limits. Plain text, decorative buttons and file links are not command controls.

1. First understand any choice already made in ordinary language. Route a clear request directly; do not force the user through a menu or ask them to select it again.
2. If the area is not clear, offer relevant areas as clickable choices. Include combinations and a complete assessment when useful.
3. Show commands for the selected area only. Use the exact command ID from command-routing.json internally. Each visible option must include the command name and a short explanation of what it produces or the decision it supports.
4. For long menus, use small groups or pages with real Next/Back controls where supported. If the user requests the complete catalogue, provide the complete list with descriptions and a usable selection route; do not silently omit commands.
5. For a selected report, offer Executive Standard — Decision brief and Detailed Report — Full assessment, using the descriptions in REPORT-FORMATS.md. Ask separately about email delivery with Yes/No choices. Do not repeat answers already given for that report. Ask for an email address only if email is wanted.
6. Accept a typed name, command ID or ordinary-language request at every stage. Clarify only genuine ambiguity. A menu click selects a workflow; it does not authorise sending, publishing, deleting or contacting anyone.

If the host has no supported clickable control, state this briefly and offer numbered choices or ordinary language. Do not claim that clickable controls exist when they do not. An instruction-only plugin cannot add controls to an unsupported host.

Acceptance checks: a clear natural-language request skips the menu; a vague area request opens choices; every command has a description; long menus remain selectable; format and email choices are separate; choosing a report never sends it.
