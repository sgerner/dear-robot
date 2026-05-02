import fs from 'node:fs';
import path from 'node:path';
import { env } from './env';

export const defaultGlobalSkillsMarkdown = `# skills.md

- Use this file for reusable workflows, stable heuristics, and tool usage notes.
- Keep entries short and specific. Prefer bullets and examples over long prose.
- Put tool-specific instructions in the matching tool playbook files.
- Only include instructions that should be reused often.
`;

function globalSkillsPath() {
  return path.join(env.DATA_DIR, 'skills.md');
}

function toolSkillsPath(toolId: number) {
  return path.join(env.DATA_DIR, 'tool-skills', `${toolId}.md`);
}

function ensureFile(filePath: string, defaultMarkdown: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, defaultMarkdown, 'utf8');
  }
}

export function readGlobalSkillsMarkdown() {
  fs.mkdirSync(env.DATA_DIR, { recursive: true });
  const filePath = globalSkillsPath();
  ensureFile(filePath, defaultGlobalSkillsMarkdown);
  return fs.readFileSync(filePath, 'utf8');
}

export function writeGlobalSkillsMarkdown(markdown: string) {
  fs.mkdirSync(env.DATA_DIR, { recursive: true });
  fs.writeFileSync(globalSkillsPath(), markdown, 'utf8');
}

export function readToolSkillsMarkdown(toolId: number) {
  const filePath = toolSkillsPath(toolId);
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8');
}

export function writeToolSkillsMarkdown(toolId: number, markdown: string) {
  const filePath = toolSkillsPath(toolId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, markdown, 'utf8');
}

export function deleteToolSkillsMarkdown(toolId: number) {
  const filePath = toolSkillsPath(toolId);
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
}

export function truncateMarkdown(markdown: string, maxChars = 2400) {
  const trimmed = markdown.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars).trimEnd()}\n\n[truncated]`;
}
