/* Shared icon-map for plan feature bullets.
 * Admin picks one of these per bullet from the AdminPlans editor and the
 * Plans page renders the matching Lucide icon.
 */
import {
  Leaf, Clock, Star, Check, Truck, Utensils, Zap, Heart, Shield, Flame,
} from "lucide-react";

export const BULLET_ICONS = {
  leaf: Leaf,
  clock: Clock,
  star: Star,
  check: Check,
  truck: Truck,
  utensils: Utensils,
  zap: Zap,
  heart: Heart,
  shield: Shield,
  flame: Flame,
};

export const BULLET_ICON_KEYS = Object.keys(BULLET_ICONS);

export function getBulletIcon(name) {
  return BULLET_ICONS[(name || "").toLowerCase()] || BULLET_ICONS.check;
}
