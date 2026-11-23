/**
 * AppNavigator — bottom-tab navigator for Boba Buddies mobile.
 *
 * 4 tabs (same pattern as Punchslate's RootNavigator):
 *   Room 🏠 · Play 🎮 · Shop 🛍️ · Pals 🐾
 *
 * Self-contained: includes the NavigationContainer, so the coordinator
 * just renders <AppNavigator /> in App.tsx.
 */
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import RoomScreen from '../screens/RoomScreen';
import PlayScreen from '../screens/PlayScreen';
import ShopScreen from '../screens/ShopScreen';
import PalsScreen from '../screens/PalsScreen';
import { COLORS } from '../screens/theme';

export type TabParamList = {
  Room: undefined;
  Play: undefined;
  Shop: undefined;
  Pals: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

const TAB_ICONS: Record<keyof TabParamList, string> = {
  Room: '🏠',
  Play: '🎮',
  Shop: '🛍️',
  Pals: '🐾',
};

export default function AppNavigator({ initialRouteName }: { initialRouteName?: keyof TabParamList } = {}) {
  return (
    <NavigationContainer>
      <Tab.Navigator
        initialRouteName={initialRouteName}
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.6 }}>
              {TAB_ICONS[route.name]}
            </Text>
          ),
          tabBarStyle: {
            backgroundColor: COLORS.surface,
            borderTopColor: '#f3c6d3',
            borderTopWidth: 2,
            height: 68,
            paddingBottom: 10,
            paddingTop: 8,
          },
          tabBarActiveTintColor: COLORS.brand,
          tabBarInactiveTintColor: COLORS.muted,
          tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        })}
      >
        <Tab.Screen name="Room" component={RoomScreen} options={{ tabBarLabel: 'Room' }} />
        <Tab.Screen name="Play" component={PlayScreen} options={{ tabBarLabel: 'Play' }} />
        <Tab.Screen name="Shop" component={ShopScreen} options={{ tabBarLabel: 'Shop' }} />
        <Tab.Screen name="Pals" component={PalsScreen} options={{ tabBarLabel: 'Pals' }} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
