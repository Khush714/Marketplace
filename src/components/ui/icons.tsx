import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function makeIcon(path: React.ReactNode) {
  return function Icon(props: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        width="1em"
        height="1em"
        {...props}
      >
        {path}
      </svg>
    );
  };
}

export const SearchIcon = makeIcon(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </>,
);

export const MapPinIcon = makeIcon(
  <>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
    <circle cx="12" cy="10" r="3" />
  </>,
);

export const ClockIcon = makeIcon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>,
);

export const StarIcon = makeIcon(
  <path d="M12 2.5l2.9 5.9 6.6 1-4.7 4.6 1.1 6.5L12 17.4 6.1 20.5l1.1-6.5L2.5 9.4l6.6-1z" />,
);

export const ChevronRightIcon = makeIcon(<path d="m9 6 6 6-6 6" />);

export const ChevronDownIcon = makeIcon(<path d="m6 9 6 6 6-6" />);

export const ArrowLeftIcon = makeIcon(
  <>
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </>,
);

export const ArrowRightIcon = makeIcon(
  <>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </>,
);

export const UserIcon = makeIcon(
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
  </>,
);

export const BagIcon = makeIcon(
  <>
    <path d="M6 8h12l1 12H5L6 8Z" />
    <path d="M9 8V6a3 3 0 0 1 6 0v2" />
  </>,
);

export const BellIcon = makeIcon(
  <>
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </>,
);

export const HeartIcon = makeIcon(
  <path d="M12 20.5s-7.5-4.7-9.5-9A5 5 0 0 1 12 7a5 5 0 0 1 9.5 4.5c-2 4.3-9.5 9-9.5 9Z" />,
);

export const PlusIcon = makeIcon(
  <>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </>,
);

export const MinusIcon = makeIcon(<path d="M5 12h14" />);

export const CheckIcon = makeIcon(<path d="M20 6 9 17l-5-5" />);

export const XIcon = makeIcon(
  <>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </>,
);

export const MenuIcon = makeIcon(
  <>
    <path d="M4 6h16" />
    <path d="M4 12h16" />
    <path d="M4 18h16" />
  </>,
);

export const SlidersIcon = makeIcon(
  <>
    <path d="M4 6h16" />
    <path d="M4 12h16" />
    <path d="M4 18h16" />
    <circle cx="9" cy="6" r="2" />
    <circle cx="15" cy="12" r="2" />
    <circle cx="7" cy="18" r="2" />
  </>,
);

export const CompassIcon = makeIcon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
  </>,
);

export const BikeIcon = makeIcon(
  <>
    <circle cx="5.5" cy="17.5" r="3.5" />
    <circle cx="18.5" cy="17.5" r="3.5" />
    <path d="M9 17.5h6" />
    <path d="M12 5 14 9l5 0" />
    <path d="M18 17.5 15.5 9H12" />
  </>,
);

export const FireIcon = makeIcon(
  <path d="M12 3c1 4-4 6-4 10a6 6 0 1 0 12 0c0-3-2-5-3-7-1 2-3 2-3 2-1-2 0-4-2-5Z" />,
);

export const StoreIcon = makeIcon(
  <>
    <path d="M3 9 5 3h14l2 6" />
    <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
    <path d="M5 12v8h14v-8" />
    <path d="M9 20v-5h6v5" />
  </>,
);

export const LogOutIcon = makeIcon(
  <>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </>,
);

export const TrashIcon = makeIcon(
  <>
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="m19 6-1 14H6L5 6" />
  </>,
);

export const ExternalIcon = makeIcon(
  <>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
  </>,
);

export const ZzzIcon = makeIcon(
  <>
    <path d="M11 5h6l-6 6h6" />
    <path d="M5 15h4l-4 4h4" />
  </>,
);