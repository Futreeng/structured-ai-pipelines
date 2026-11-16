export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import JSZip from 'jszip'
import { getForgeSessionOrDemo } from '@/src/lib/auth-helpers'
import { getForgeRunWithDetails } from '@/src/services/forge/db'

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await props.params
  const session = await getForgeSessionOrDemo()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const details = await getForgeRunWithDetails(id)
  if (!details) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  if (details.run.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const files = (details.diff?.files ?? []) as Array<{ path: string; content: string }>
  if (files.length === 0) {
    return NextResponse.json({ error: 'No generated files for this run' }, { status: 404 })
  }

  const zip = new JSZip()
  for (const file of files) zip.file(file.path, file.content)
  const buffer = await zip.generateAsync({ type: 'nodebuffer' })

  const base = (details.run.prdTitle ?? `forge-run-${id.slice(0, 8)}`)
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .toLowerCase()

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${base}.zip"`,
    },
  })
}
