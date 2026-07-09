<script setup lang="ts">
import type { CommandHint } from '../api'

defineProps<{ hint: CommandHint | null }>()
</script>

<template>
  <div v-if="hint && (hint.flags.length || hint.subcommands?.length)" class="hint-bar">
    <span class="hint-base">{{ hint.base }}</span>
    <template v-if="hint.subcommands?.length">
      <span v-for="s in hint.subcommands" :key="s.name" class="hint-item">
        <code>{{ s.name }}</code>{{ s.desc }}
      </span>
    </template>
    <template v-else>
      <span v-for="f in hint.flags" :key="f.flag" class="hint-item">
        <code>{{ f.flag }}</code>{{ f.desc }}
      </span>
    </template>
  </div>
</template>

<style scoped>
.hint-bar {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 16px;
  padding: 6px 14px;
  background: var(--bg-soft);
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-dim);
  max-height: 64px;
  overflow-y: auto;
}
.hint-base {
  font-weight: 700;
  color: var(--accent);
  font-family: monospace;
}
.hint-item code {
  color: #e6b673;
  font-family: monospace;
  margin-right: 4px;
}
</style>
