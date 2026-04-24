import { DemoCta } from '@/components/home/demo-cta';
import { Hero } from '@/components/home/hero';
import { HowItWorks } from '@/components/home/how-it-works';
import { Integrate } from '@/components/home/integrate';
import { LiveStream } from '@/components/home/live-stream';

/**
 * Home landing — M-INT.2.
 *
 * Sections in scroll order: Hero → How it works → Integrate → Live tx stream → Demo CTA.
 * Anchor ids: #how-it-works, #integrate, #live (consumed by nav links).
 */
export default function HomePage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <Integrate />
      <LiveStream />
      <DemoCta />
    </>
  );
}
