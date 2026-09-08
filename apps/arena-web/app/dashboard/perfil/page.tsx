import { AppShell } from '../../../components/app-shell';
import { OwnerNavigation } from '../../../components/owner-navigation';
import { ProfilePanel } from '../../../components/profile-panel';
import { OwnerGuard } from '../../../components/owner-guard';
export default function ProfilePage(){return <AppShell eyebrow="Conta" title="Seu perfil" subtitle="Dados da sua conta e acesso ao painel."><OwnerGuard><OwnerNavigation/><ProfilePanel/></OwnerGuard></AppShell>}
