# Contributing

## Frontend Design System Rule

Civitas uses Bootstrap as a base and local design primitives as the standard UI layer.

### Mandatory rules

- Do not declare hardcoded colors inside files under `frontend/src/pages/` or `frontend/src/views/`.
- Do not declare new border-radius or spacing values in page-level CSS when an equivalent token already exists.
- If a new visual value is needed, add it first to `frontend/src/styles/tokens.css` and then consume it from there.
- New dashboard and KPI views must prefer shared primitives from `frontend/src/shared/ui/` before introducing page-specific visual components.
- Page-level CSS should compose shared primitives and adjust layout, not redefine the visual language of cards, pills, metrics, and tables.

### Expected frontend foundation

- Bootstrap remains the base dependency and should not be copied into the repository as a vendored CSS framework.
- Shared visual tokens live in `frontend/src/styles/tokens.css`.
- Shared dashboard primitives live in `frontend/src/styles/dashboard.css` and `frontend/src/shared/ui/`.
- CSS ad hoc in pages without a token or primitive justification should be treated as a review problem.
