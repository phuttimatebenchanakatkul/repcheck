/**
 * React Query keys. Every key starts with ['data', userId, ...]: a different person on the same device can never be handed another's
 * cached copy even if a wipe were missed, and one prefix invalidates everything (['data', userId]).
 */
export const keys = {
  all: (userId: string) => ['data', userId] as const,
  nutritionDay: (userId: string, day: string) => ['data', userId, 'nutrition', day] as const,
  nutritionRange: (userId: string, from: string, to: string) => ['data', userId, 'nutrition-range', from, to] as const,
  nutritionRangePrefix: (userId: string) => ['data', userId, 'nutrition-range'] as const,
  nutritionRecent: (userId: string) => ['data', userId, 'nutrition-recent'] as const,
  goals: (userId: string) => ['data', userId, 'goals'] as const,
  nutritionFavorites: (userId: string) => ['data', userId, 'nutrition-favorites'] as const,
  workoutDay: (userId: string, day: string) => ['data', userId, 'workouts', day] as const,
  workoutRecent: (userId: string) => ['data', userId, 'workouts-recent'] as const,
  exerciseFavorites: (userId: string) => ['data', userId, 'exercise-favorites'] as const,
  splitPlan: (userId: string) => ['data', userId, 'split-plan'] as const,
  weights: (userId: string, from: string, to: string) => ['data', userId, 'weights', from, to] as const,
  weightsPrefix: (userId: string) => ['data', userId, 'weights'] as const,
  dayStatuses: (userId: string, from: string, to: string) => ['data', userId, 'day-status', from, to] as const,
  dayStatusPrefix: (userId: string) => ['data', userId, 'day-status'] as const,
  settings: (userId: string) => ['data', userId, 'settings'] as const,
  activeDays: (userId: string) => ['data', userId, 'active-days'] as const,
  customFoods: (userId: string) => ['data', userId, 'custom-foods'] as const,
  customExercises: (userId: string) => ['data', userId, 'custom-exercises'] as const,
  coachThread: (userId: string, day: string) => ['data', userId, 'coach-thread', day] as const,
  coachThreadPrefix: (userId: string) => ['data', userId, 'coach-thread'] as const,
  workoutThread: (userId: string, day: string) => ['data', userId, 'workout-thread', day] as const,
  workoutThreadPrefix: (userId: string) => ['data', userId, 'workout-thread'] as const,
  workoutHistory: (userId: string) => ['data', userId, 'workout-history'] as const,
  coachingRow: (userId: string) => ['data', userId, 'coaching-profile'] as const,
  analysisThread: (userId: string, analysisId: number) => ['data', userId, 'analysis-thread', analysisId] as const,
  analysisThreadPrefix: (userId: string) => ['data', userId, 'analysis-thread'] as const,
};
