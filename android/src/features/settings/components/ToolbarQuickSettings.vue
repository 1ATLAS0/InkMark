<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { MobileCommandId } from '../../../lib/mobileCommands'
import { useI18n, type I18nKey } from '../../../lib/i18n'
import {
  MOBILE_TOOLBAR_PANELS,
  getMobileToolbarCommandButton,
  type MobileToolbarCommandButton,
} from '../../../lib/mobileToolbarConfig'
import {
  DEFAULT_TOOLBAR_CUSTOM_COMMAND_IDS,
  TOOLBAR_CUSTOM_COMMANDS_STORAGE_KEY,
  TOOLBAR_FIXED_QUICK_COMMAND_ID,
  normalizeToolbarCustomQuickCommands,
  serializeToolbarCustomQuickCommands,
} from '../../editor/editorToolbarSettings'
import { useSettingsState } from '../settingsState'
import { useQuickBarReorder } from './useQuickBarReorder'
import ToolbarCommandGlyph from '../../../components/ToolbarCommandGlyph.vue'

defineProps<{
  testId: string
}>()

const { getValue, hasValue, setValue } = useSettingsState()
const { t } = useI18n()
const quickBarScroller = ref<HTMLElement | null>(null)
const fixedCommand = getMobileToolbarCommandButton(TOOLBAR_FIXED_QUICK_COMMAND_ID)

const customCommandIds = computed(() =>
  normalizeToolbarCustomQuickCommands(getValue(TOOLBAR_CUSTOM_COMMANDS_STORAGE_KEY, '')),
)
const selectedCommandIds = computed(() => new Set(customCommandIds.value))
const commandGroups = computed(() =>
  MOBILE_TOOLBAR_PANELS.map(panel => ({
    id: panel.id,
    labelKey: panel.labelKey,
    commands: panel.commands,
  })),
)

function getCommandTitle(command: { title: string; titleKey: I18nKey }) {
  return t(command.titleKey) || command.title
}

function commandTestId(commandId: MobileCommandId) {
  return commandId.replace(/[^a-z0-9]+/gi, '-')
}

function setCustomCommandIds(commandIds: readonly MobileCommandId[]) {
  setValue(TOOLBAR_CUSTOM_COMMANDS_STORAGE_KEY, serializeToolbarCustomQuickCommands(commandIds))
}

if (!hasValue(TOOLBAR_CUSTOM_COMMANDS_STORAGE_KEY)) {
  setCustomCommandIds(DEFAULT_TOOLBAR_CUSTOM_COMMAND_IDS)
}

const {
  editing,
  pressedCommandId,
  draggingCommandId,
  exitEditMode,
  onCommandPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
} = useQuickBarReorder({
  commandIds: customCommandIds,
  scrollerRef: quickBarScroller,
  setCommandIds: setCustomCommandIds,
})

const customCommands = computed(() =>
  customCommandIds.value
    .map(commandId => getMobileToolbarCommandButton(commandId))
    .filter((command): command is MobileToolbarCommandButton => Boolean(command)),
)

async function scrollPreviewToEnd() {
  await nextTick()
  const scroller = quickBarScroller.value
  if (scroller) {
    scroller.scrollTo({ left: scroller.scrollWidth, behavior: 'smooth' })
  }
}

function addCommand(commandId: MobileCommandId) {
  if (selectedCommandIds.value.has(commandId)) {
    return
  }

  setCustomCommandIds([...customCommandIds.value, commandId])
  scrollPreviewToEnd()
}

function removeCommand(commandId: MobileCommandId) {
  setCustomCommandIds(customCommandIds.value.filter(selectedCommandId => selectedCommandId !== commandId))
}

function restoreDefaultQuickBar() {
  setCustomCommandIds(DEFAULT_TOOLBAR_CUSTOM_COMMAND_IDS)
  exitEditMode()
  nextTick(() => quickBarScroller.value?.scrollTo({ left: 0, behavior: 'smooth' }))
}

function isCommandDisabled(command: MobileToolbarCommandButton) {
  return selectedCommandIds.value.has(command.commandId)
}

function onFixedCommandPointerDown(event: PointerEvent) {
  if (fixedCommand) {
    onCommandPointerDown(event, fixedCommand.commandId, false)
  }
}
</script>

<template>
  <div
    class="toolbar-quick-settings"
    :class="{ 'is-editing': editing }"
    :data-testid="testId"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
  >
    <div class="quickbar-custom-header">
      <h3>{{ t('settings.toolbar.custom.title') }}</h3>
      <div class="quickbar-actions">
        <button
          v-if="editing"
          class="quickbar-done-button"
          type="button"
          data-testid="settings-quickbar-done"
          @click="exitEditMode"
        >
          {{ t('settings.toolbar.custom.done') }}
        </button>
        <button
          class="quickbar-reset-button"
          type="button"
          data-testid="settings-quickbar-restore-default"
          @click="restoreDefaultQuickBar"
        >
          {{ t('settings.toolbar.custom.restoreDefault') }}
        </button>
      </div>
    </div>

    <div
      ref="quickBarScroller"
      class="quickbar-preview"
      role="group"
      :aria-label="t('settings.toolbar.custom.preview')"
      data-testid="settings-quickbar-preview"
    >
      <div v-if="fixedCommand" class="quickbar-item is-fixed">
        <button
          class="quickbar-slot"
          type="button"
          :aria-label="t('settings.toolbar.custom.fixedCommand', {
            command: getCommandTitle(fixedCommand),
          })"
          data-testid="settings-quickbar-slot-fixed"
          @contextmenu.prevent
          @pointerdown="onFixedCommandPointerDown"
        >
          <ToolbarCommandGlyph :command="fixedCommand" />
        </button>
      </div>

      <div
        v-for="(command, index) in customCommands"
        :key="command.commandId"
        class="quickbar-item is-editable"
        :class="{
          'is-pressed': pressedCommandId === command.commandId,
          'is-dragging': draggingCommandId === command.commandId,
        }"
        :data-command-id="command.commandId"
        data-quickbar-draggable="true"
        :data-testid="`settings-quickbar-slot-${index}`"
      >
        <button
          class="quickbar-slot"
          type="button"
          :aria-label="getCommandTitle(command)"
          :data-testid="`settings-quickbar-button-${commandTestId(command.commandId)}`"
          @contextmenu.prevent
          @pointerdown="event => onCommandPointerDown(event, command.commandId, true)"
        >
          <ToolbarCommandGlyph :command="command" />
        </button>
        <button
          v-if="editing"
          class="quickbar-remove-button"
          type="button"
          :aria-label="t('settings.toolbar.custom.removeCommand', {
            command: getCommandTitle(command),
          })"
          :data-testid="`settings-quickbar-remove-${commandTestId(command.commandId)}`"
          @pointerdown.stop
          @click.stop="removeCommand(command.commandId)"
        >
          ×
        </button>
      </div>
    </div>

    <div class="quickbar-command-groups">
      <section
        v-for="group in commandGroups"
        :key="group.id"
        class="quickbar-command-group"
        :data-testid="`settings-quickbar-group-${group.id}`"
      >
        <h4>{{ t(group.labelKey) }}</h4>
        <div class="quickbar-command-grid">
          <button
            v-for="command in group.commands"
            :key="command.commandId"
            class="quickbar-command-button"
            :class="{ 'is-selected': selectedCommandIds.has(command.commandId) }"
            type="button"
            :disabled="isCommandDisabled(command)"
            :aria-pressed="selectedCommandIds.has(command.commandId)"
            :aria-label="t('settings.toolbar.custom.addCommand', {
              command: getCommandTitle(command),
            })"
            :data-testid="`settings-quickbar-command-${commandTestId(command.commandId)}`"
            @click="addCommand(command.commandId)"
          >
            <ToolbarCommandGlyph :command="command" />
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped src="./quickbarSettings.css"></style>
