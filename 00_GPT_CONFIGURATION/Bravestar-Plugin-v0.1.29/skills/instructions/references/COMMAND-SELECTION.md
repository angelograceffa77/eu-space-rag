# Guided choices: area, report, information

This is the shared menu and report-intake procedure. Use simple language and real clickable controls supported by the host. In Codex, use the available native choice/question tool, such as request_user_input_async, within its actual limits. Decorative buttons, plain text and file links are not command controls.

## 1. Offer areas first

At the start of a new conversation, after the short introduction, offer the area menu without asking whether the user wants to see commands. Offer:

- Policy and lobbying — understand policies, priorities and business implications.
- Stakeholders and events — identify decision-makers, engagement routes and relevant events.
- Law and contracts — understand legal duties, licensing and agreements.
- Procurement — find and assess tenders, planned purchases and awards.
- Funding — find and assess funding calls and application requirements.
- Startups — plan growth, incubation and fundraising.
- Incubators and accelerators — assess and support a startup portfolio.
- Investors — screen companies and assess investment opportunities.
- Clients and partners — identify markets, customers and commercial partners.
- Industry news and monitoring — review recent developments and upcoming opportunities.
- Combined business reports — bring several areas into one assessment.

Allow a combination of areas or all areas. If a tool only permits one choice at a time, let the user add another area before continuing. Keep all areas reachable through small groups or pages when the host limits menu size. Do not repeat the introduction on later menus.

## 2. Offer commands within the selected areas

Read command-routing.json and use its exact IDs, names and descriptions. Map POL to Policy, STK to Stakeholders, LAW to Law, PRO to Procurement, FUN to Funding, STA to Startups, INC to Incubators, INV to Investors, CLI to Clients, MON/NEWS to Monitoring, and COM to Combined reports. Include monthly updates in their relevant areas. These are menu groups, not new commands or new specialist skills.

Show every command available within the selected areas, using manageable groups or pages. Each clickable option must show the command name and a short description of its purpose. Keep the full catalogue available on request, but do not display unrelated commands by default. Offer a way to return to areas or change the selection. Do not silently omit commands when a menu is long.

## 3. Guide the report intake

After selection, read the matching template, profile and specialist requirements before asking questions. Ask only for missing information that matters to that report, in small steps:

1. Confirm the company or project where relevant. Accept a website or user-provided profile; do not invent its identity.
2. Establish the decision to support, geography, period and relevant restrictions. Offer useful clickable choices based on the selected report, with ordinary-language input always available.
3. Request any required documents. Bid/No-Bid Assessment and Funding Fit and Eligibility Assessment require the official tender or call documents under their existing rules. For an Initial Contract Draft, collect the agreement purpose, parties, material terms, governing law and existing drafts. Use the host's attachment route for files, not a text-only choice tool. A click saying a file exists does not mean it was received or read.
4. Offer Executive Standard — Decision brief (concise findings, essential reasoning and priority actions) or Detailed Report — Full assessment (deeper analysis, sources, comparisons and an implementation plan), following REPORT-FORMATS.md. Ask for the preferred language if unknown.
5. Ask whether the user wants email delivery using Yes/No choices. If Yes, request or confirm the address; if No, deliver in the conversation. Delivery preference is not permission to send the final version; follow the existing delivery rules.
6. Briefly recap the selected report, known scope and remaining gaps. Ask a further question only if a necessary detail is unresolved. Do not add a routine approval step before research. Give the required time estimate before report generation.

Use choices for bounded decisions, and a short text question or attachment request when the answer needs names, an address, a website, detailed terms or documents. Offer Not sure where appropriate and help explain the decision; do not turn uncertainty into an assumed legal or eligibility fact. Explain briefly why any essential missing input is needed. If it remains unavailable, follow the existing limited-report or hold rules.

## 4. Respect ordinary language and avoid repetition

A clear typed request counts as a selection. If the user names an area, open its commands directly. If they name a report, go straight to its missing inputs. If they ask a factual question, answer it directly. Never force the user to click a choice they already made. Reuse answers already supplied for the assignment; allow changes at any point. A menu click does not authorise sending, publishing, deleting or contacting anyone.

## 5. When clickable controls are unavailable

Explain the limitation briefly and offer numbered choices or ordinary language. Do not claim that controls exist when they do not. An instruction-only plugin cannot add controls to an unsupported host.

## Checks

Check these cases: a new conversation offers areas; an area opens its commands with descriptions; multiple areas retain all their commands; a named report skips unnecessary menus; missing inputs are requested in small steps; known answers are not requested again; required uploads use the attachment route; format and email choices remain separate; choosing a report never sends it; all commands remain reachable; unsupported interfaces receive an honest fallback.
