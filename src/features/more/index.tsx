import { LinkList, LinkRow, PageHeader, Stack } from '@/ui/kit'

export default function More() {
  return (
    <>
      <PageHeader title="More" />
      <Stack>
        <LinkList>
          <LinkRow
            to="/activities"
            icon="list"
            label="Activities"
            hint="Units, blocks, weekly targets"
          />
          <LinkRow to="/routines" icon="play" label="Routines" hint="Set lists of activities" />
        </LinkList>
        <LinkList>
          <LinkRow to="/settings" icon="settings" label="Settings" hint="Week start, rest" />
          <LinkRow
            to="/settings/data"
            icon="download"
            label="Data & backup"
            hint="Backup, restore, CSV"
          />
        </LinkList>
      </Stack>
    </>
  )
}
