import { CourtEditor } from '../../../../components/court-management';

export default async function EditCourtPage({ params }: { params: Promise<{ courtId: string }> }) { const { courtId } = await params; return <CourtEditor courtId={courtId} mode="edit" />; }
