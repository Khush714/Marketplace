import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BadgePercent, Bike, Flame, Star, Timer, Wallet } from "lucide-react";
import { HomeHero } from "@/components/home-hero";
import { Rail } from "@/components/rail";
import { RestaurantCard } from "@/components/restaurant-card";
import { SectionHeader } from "@/components/atoms";
import { browseRestaurants, featuredRestaurants } from "@/db/queries";

export const dynamic = "force-dynamic";

const TICKER = [
  { Icon: Bike, text: "Free delivery over ₹499" },
  { Icon: Timer, text: "15-minute fastest kitchens" },
  { Icon: Star, text: "4.6 average city rating" },
  { Icon: Wallet, text: "UPI · Cards · Cash" },
  { Icon: Flame, text: "Live-fire kitchens open late" },
];

export default async function HomePage() {
  const [all, featured, offers, topRated, nearby] = await Promise.all([
    browseRestaurants(),
    featuredRestaurants(),
    browseRestaurants({ offers: true }),
    browseRestaurants({ sort: "rating" }),
    browseRestaurants({ sort: "near" }),
  ]);

  return (
    <div className="pb-8">
      <HomeHero restaurantCount={all.length} />

      {/* infinite ticker */}
      <div className="mt-12 overflow-hidden border-y border-white/6 py-3 md:mt-16">
        <div className="animate-marquee flex w-max items-center gap-10">
          {[0, 1].map((dup) => (
            <div key={dup} aria-hidden={dup === 1} className="flex items-center gap-10">
              {TICKER.map(({ Icon, text }, i) => (
                <span key={`${dup}-${i}`} className="flex items-center gap-2.5 whitespace-nowrap">
                  <Icon className="size-3.5 text-ember-400" />
                  <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-cream-500">{text}</span>
                  <span aria-hidden className="ml-6 size-1 rounded-full bg-chili-500/50" />
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Ember Drop — hero promo */}
      <section className="mx-auto mt-12 max-w-7xl px-4 md:mt-16 md:px-6">
        <Link
          href="/restaurants/ember-and-oak"
          className="group relative block overflow-hidden rounded-[28px] shadow-float press"
        >
          <div className="absolute inset-0 bg-[radial-gradient(85%_130%_at_12%_40%,#3a1a0e_0%,#160b08_52%,#0c0705_100%)]" />
          <div className="relative grid items-center gap-4 md:grid-cols-[1.1fr_1fr]">
            <div data-reveal="left" className="p-8 md:p-12">
              <p className="flex w-fit items-center gap-1.5 rounded-full bg-chili-500/18 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-chili-300">
                <BadgePercent className="size-3.5" /> The Ember Drop
              </p>
              <h2 className="mt-4 font-display text-3xl font-bold leading-[1.05] tracking-tight text-cream-50 md:text-5xl">
                Smash burgers,
                <br />
                <span className="text-gradient">50% off tonight</span>
              </h2>
              <p className="mt-3 max-w-sm text-sm leading-relaxed text-cream-400">
                Live-fire patties from Ember &amp; Oak — engineered to travel, built to be devoured.
              </p>
              <span className="mt-6 inline-flex items-center gap-2 rounded-full bg-gradient-to-b from-ember-400 to-chili-600 px-5 py-2.5 text-sm font-bold text-white shadow-glow transition-transform duration-300 group-hover:scale-[1.03]">
                Order the drop
                <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
              </span>
            </div>
            <div className="zoom-on-scroll relative aspect-[16/10] md:aspect-auto md:h-full md:min-h-[340px]">
              <Image
                src="/images/hero-burger.jpg"
                alt="Smash burger with melted cheddar and caramelised onions"
                fill
                priority
                sizes="(max-width: 768px) 100vw, 44vw"
                className="object-cover object-center transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.05]"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-[#160b08] via-transparent to-transparent md:bg-[linear-gradient(90deg,#160b08_0%,transparent_35%)]" />
              <span
                aria-hidden
                className="sheen-band absolute inset-y-0 -left-1/3 w-1/3 opacity-0 group-hover:animate-sheen group-hover:opacity-100"
              />
            </div>
          </div>
        </Link>
      </section>

      {/* Featured rail */}
      <section className="mx-auto mt-14 max-w-7xl px-4 md:mt-20 md:px-6">
        <div data-reveal="up">
          <SectionHeader title="Featured tonight" sub="Hand-picked kitchens at the top of their game" href="/restaurants?sort=rating" />
        </div>
        <Rail ariaLabel="Featured restaurants">
          {featured.map((r, i) => (
            <RestaurantCard
              key={r.slug}
              restaurant={r}
              size="lg"
              priority={i < 2}
              index={i}
              className="w-[78vw] max-w-[340px] shrink-0 snap-start md:w-[340px]"
            />
          ))}
        </Rail>
      </section>

      {/* Popular near you */}
      <section className="mx-auto mt-14 max-w-7xl px-4 md:mt-20 md:px-6">
        <div data-reveal="up">
          <SectionHeader title="Popular near you" sub="Within a short ride of Indiranagar" href="/restaurants?sort=near" />
        </div>
        <div className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {nearby.slice(0, 8).map((r, i) => (
            <RestaurantCard key={r.slug} restaurant={r} index={i} />
          ))}
        </div>
      </section>

      {/* Dessert promo */}
      <section className="mx-auto mt-14 max-w-7xl px-4 md:mt-20 md:px-6">
        <Link
          href="/restaurants/the-velvet-crumb"
          className="group relative block overflow-hidden rounded-[28px] shadow-float press"
        >
          <div className="absolute inset-0 bg-[radial-gradient(85%_130%_at_88%_40%,#2a1030_0%,#150a1c_52%,#0c0710_100%)]" />
          <div className="relative grid items-center gap-4 md:grid-cols-[1fr_1.1fr]">
            <div className="zoom-on-scroll relative order-2 aspect-[16/10] md:order-1 md:aspect-auto md:h-full md:min-h-[300px]">
              <Image
                src="/images/promo-dessert.svg"
                alt="Molten chocolate lava cake with raspberries"
                fill
                sizes="(max-width: 768px) 100vw, 44vw"
                className="object-cover object-center transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.05]"
              />
              <div className="absolute inset-0 bg-[linear-gradient(270deg,#150a1c_0%,transparent_40%)]" />
              <span
                aria-hidden
                className="sheen-band absolute inset-y-0 -left-1/3 w-1/3 opacity-0 group-hover:animate-sheen group-hover:opacity-100"
              />
            </div>
            <div data-reveal="left" className="order-1 p-8 md:order-2 md:p-12">
              <p className="w-fit rounded-full bg-berry-400/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-berry-400">
                Sweet endings
              </p>
              <h2 className="mt-4 font-display text-3xl font-bold leading-[1.05] tracking-tight text-cream-50 md:text-4xl">
                The midnight
                <br />
                <span className="bg-gradient-to-r from-berry-400 to-chili-400 bg-clip-text text-transparent">
                  patisserie club
                </span>
              </h2>
              <p className="mt-3 max-w-sm text-sm leading-relaxed text-cream-400">
                Small-batch cakes baked at dawn. ₹100 off your first indulgence from The Velvet Crumb.
              </p>
              <span className="mt-6 inline-flex items-center gap-2 rounded-full border border-berry-400/35 px-5 py-2.5 text-sm font-bold text-berry-400 transition-all duration-300 group-hover:bg-berry-400/10">
                Claim the offer
                <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
              </span>
            </div>
          </div>
        </Link>
      </section>

      {/* Top rated rail */}
      <section className="mx-auto mt-14 max-w-7xl px-4 md:mt-20 md:px-6">
        <div data-reveal="up">
          <SectionHeader title="Top rated" sub="Consistently exceptional, according to the city" href="/restaurants?sort=rating" />
        </div>
        <Rail ariaLabel="Top rated restaurants">
          {topRated.slice(0, 8).map((r, i) => (
            <RestaurantCard
              key={r.slug}
              restaurant={r}
              index={i}
              className="w-[70vw] max-w-[300px] shrink-0 snap-start md:w-[300px]"
            />
          ))}
        </Rail>
      </section>

      {/* Offers */}
      <section className="mx-auto mt-14 max-w-7xl px-4 md:mt-20 md:px-6">
        <div data-reveal="up">
          <SectionHeader title="Offers near you" sub="Deals worth crossing the street for" href="/restaurants?offers=1" />
        </div>
        <div className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {offers.slice(0, 8).map((r, i) => (
            <RestaurantCard key={r.slug} restaurant={r} index={i} />
          ))}
        </div>
      </section>
    </div>
  );
}
