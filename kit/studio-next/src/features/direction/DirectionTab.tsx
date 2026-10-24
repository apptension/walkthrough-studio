import { PanelSection } from '@/ui/PanelSection';

import { BrandFoundation, ColorScaleSection, DirectionHead, FocusSection, LogoSection } from './BrandSections';
import { CameraSection } from './CameraSection';
import { LiveCardsField } from './LiveCardsField';
import { AtmosphereField, EffectsField, EnergyField } from './MotionFields';
import { PaceSection } from './PaceSection';
import { PlateBin } from './PlateBin';
import { PlateLayoutsField } from './PlateLayoutsField';
import { SizeSection } from './SizeSection';
import { TransitionsField } from './TransitionsField';
import { useDirectionSync } from './useDirectionSync';

/** `#rightMotion`: the video's visual direction — brand, pace, size, camera, motion and plates. */
export function DirectionTab() {
  useDirectionSync();
  return (
    <div id="rightMotion" className="panel-body" hidden>
      <DirectionHead />
      <BrandFoundation />
      <ColorScaleSection />
      <LogoSection />
      <FocusSection />
      <PaceSection />
      <SizeSection />
      <CameraSection />
      <PanelSection
        id="motion"
        icon="motion"
        title="Motion & transitions"
        help="Fine-tune energy, atmosphere, live cards, effects, plate layouts and transitions."
        className="direction-advanced"
      >
        <EnergyField />
        <AtmosphereField />
        <LiveCardsField />
        <EffectsField />
        <PlateLayoutsField />
        <TransitionsField />
      </PanelSection>
      <PlateBin />
    </div>
  );
}
