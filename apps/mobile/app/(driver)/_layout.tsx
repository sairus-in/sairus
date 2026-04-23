// app/(driver)/_layout.tsx — Driver stack navigator
import { Stack } from 'expo-router';

export default function DriverLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="route-preview" />
      <Stack.Screen name="kiosk" />
      <Stack.Screen name="breakdown" />
      <Stack.Screen name="post-breakdown" />
      <Stack.Screen name="summary" />
      <Stack.Screen name="messages" />
    </Stack>
  );
}
