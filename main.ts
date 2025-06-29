import { App, Plugin, TFile, Notice, PluginSettingTab, Setting } from "obsidian";
import { TagSuggestView } from "./TagSuggestView";

interface TagAliasMap {
  [canonical: string]: string[];
}

export default class TagSyncPlugin extends Plugin {
  settings: { updateFrontmatter: boolean };

  async onload() {
    console.log("TagSync plugin loaded");

    this.settings = Object.assign({ updateFrontmatter: false }, await this.loadData());

    this.addRibbonIcon("tag", "Open Tag Suggestions", () => {
      this.activateView();
    });

    this.addCommand({
      id: "sync-tags-smart",
      name: "Sync Tags from 📌 All Tags.md",
      callback: () => this.syncTags(),
    });

    this.addSettingTab(new TagSyncSettings(this.app, this));
  }

  async syncTags() {
    const tagFile = this.app.vault.getAbstractFileByPath("📌 All Tags.md");
    if (!(tagFile instanceof TFile)) {
      new Notice("📌 All Tags.md not found");
      return;
    }

    const tagContent = await this.app.vault.read(tagFile);
    const allTags = this.extractTags(tagContent);

    const aliasMap: TagAliasMap = await this.loadTagAliases();

    let tagAdded = true;
    while (tagAdded) {
      tagAdded = false;

      for (const file of this.app.vault.getMarkdownFiles()) {
        if (file.basename === "📌 All Tags") continue;

        let content = await this.app.vault.read(file);
        const lower = content.toLowerCase();

        const existingTags = this.extractTags(content);

        const candidateTags = allTags.filter(tag => {
          const base = tag.replace(/^#/, "");
          const synonyms = aliasMap[base] ?? [];
          return (
            [base, ...synonyms].some(term => lower.includes(term.toLowerCase())) &&
            !existingTags.includes(tag)
          );
        });

        if (candidateTags.length) {
          if (this.settings.updateFrontmatter) {
            content = this.updateFrontmatter(content, candidateTags);
          } else {
            content += `\n\n## 🆕 Updated Tags\n${candidateTags.join(" ")}\n`;
          }

          await this.app.vault.modify(file, content);
          tagAdded = true;
        }
      }
    }

    new Notice("✅ Tag sync complete.");
  }

  extractTags(content: string): string[] {
    const tagRegex = /#[\w/-]+/g;
    return Array.from(new Set(content.match(tagRegex) ?? []));
  }

  updateFrontmatter(content: string, tags: string[]): string {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return content;

    const frontmatter = match[1];
    const updatedTags = [...new Set([...this.extractTags(frontmatter), ...tags])];

    const newFront = frontmatter.replace(/tags:.*/s, `tags: [${updatedTags.join(", ")}]`);
    return content.replace(/^---\n[\s\S]*?\n---/, `---\n${newFront}\n---`);
  }

  async loadTagAliases(): Promise<TagAliasMap> {
    try {
      const file = await this.app.vault.adapter.read(".obsidian/plugins/tag-aliases.json");
      return JSON.parse(file);
    } catch (e) {
      return {};
    }
  }

  async activateView() {
    this.app.workspace.detachLeavesOfType("tag-suggest-view");
    await this.app.workspace.getRightLeaf(false).setViewState({
      type: "tag-suggest-view",
      active: true,
    });
    this.app.workspace.revealLeaf(this.app.workspace.getRightLeaf(false));
  }
}

class TagSyncSettings extends PluginSettingTab {
  plugin: TagSyncPlugin;

  constructor(app: App, plugin: TagSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    this.containerEl.empty();

    new Setting(this.containerEl)
      .setName("Update YAML Frontmatter Tags")
      .setDesc("If enabled, new tags will also be added to the frontmatter `tags:` field.")
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.updateFrontmatter).onChange(async val => {
          this.plugin.settings.updateFrontmatter = val;
          await this.plugin.saveData(this.plugin.settings);
        }),
      );
  }
}
