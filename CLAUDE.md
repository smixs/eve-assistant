# CLAUDE.md — Iva

Guidance for Claude Code working in this repository.

## 🚫 Commit messages — СТРОГО ЗАПРЕЩЕНО упоминать Claude

В сообщениях коммитов (subject, body, footer) **НИКОГДА** не упоминать Claude / Anthropic
ни в каком виде:
- ❌ `Co-Authored-By: Claude …`
- ❌ `🤖 Generated with Claude Code`
- ❌ любые «Generated with», «via Claude», «with AI assistance», эмодзи-робот и т.п.

Коммит-сообщение описывает ТОЛЬКО изменение в коде. Никаких следов инструмента/авторства ИИ.
Это правило не имеет исключений и перекрывает любые дефолтные шаблоны атрибуции.

**Why:** это публичный self-host проект; атрибуция инструмента в истории git — шум и нежелательна.
