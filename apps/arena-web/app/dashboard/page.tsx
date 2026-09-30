import { ManagementDashboard } from '../../components/management-dashboard';
import { OwnerNavigation } from '../../components/owner-navigation';

export default function DashboardPage() {
  return <main className="min-h-screen px-4 pb-4 pt-6 md:px-8 md:pt-8"><ManagementDashboard/><OwnerNavigation/></main>;
}
