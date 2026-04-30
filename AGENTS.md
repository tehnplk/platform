## Repo feature

- ระบบดาวน์โหลดโปรแกรม PlkPlatform.exe และตรวจสอบการอับเดทอัตโนมัติจากไฟล์ lastest.json
- ระบบ WEB CHAT

## What to do first
- when user terminal to read or write source code ,You have to convert console output encoding to UTF-8

## Tect Stack
- Nextjs @package.json
- Supabase with realtime feature in docker containner name platform-repo-supabase


## Command Line Tool
- `npx ctx7 --help` for research tech document
- `db-cli --skill` for mainipulate database

## Testing Tool
- invoke `playwright-cli skill`
- user ask for anotation ui
    - run command for open browser session
        ```
        - playwright-cli open http://localhost/example
        - playwright-cli show --annotate
        ```
    - run command for user's viewer
        ```
        - playwright-cli show
        ```
    - Then wait user send you the anotatation result and edit code follow user request.

## Testing result files (important**)
- must place at  directory @.playwright-cli

## deployment
- read @docs/host.md
- main url = https://platform.plkhealth.go.th/ 