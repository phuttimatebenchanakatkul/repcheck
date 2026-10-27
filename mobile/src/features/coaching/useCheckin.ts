import { useCoachingProfile, useGoalHandled, useWeights } from '@/data/hooks';
import { checkinDaysRemaining, goalHandled, goalReached } from '@/logic/checkin';
import type { CoachingData } from '@/logic/coachingProfile';
import { addDays } from '@/logic/dates';

export interface CheckinStatus {
  loading: boolean;
  profile: CoachingData | null;
  /** Days until the weekly check-in is due, 0 when it is; null when there is no coaching profile to check in on. */
  daysRemaining: number | null;
  /** The goal weight has been reached and not yet acted on, which makes the check-in due at once. */
  goalDue: boolean;
}

/** Whether the weekly check-in is due: seven days after the last one, or at once when the newest weigh-in is at the goal. */
export function useCheckinStatus(today: string): CheckinStatus {
  const profile = useCoachingProfile();
  const handled = useGoalHandled();
  const weights = useWeights(addDays(today, -365), today);
  const newest = weights.data[weights.data.length - 1];
  const goalDue = goalReached(profile.data, newest ? newest.kg : null) && !goalHandled(profile.data, handled.data);
  return { loading: profile.isLoading || weights.isLoading, profile: profile.data, daysRemaining: checkinDaysRemaining(profile.data, goalDue, today), goalDue };
}
