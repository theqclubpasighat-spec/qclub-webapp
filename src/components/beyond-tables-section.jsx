import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

export function BeyondTablesSection() {
  const [activeImage, setActiveImage] = useState(null);
  const navigate = useNavigate();

  const foodDrinkSlides = [
    "/menu/mocktails.png",
    "/menu/momo.png",
    "/menu/Grilled Sausage.png",
    "/menu/roasted Chicken wings.png",
  ].filter(Boolean);

  const [foodDrinkSlideIndex, setFoodDrinkSlideIndex] = useState(0);

  useEffect(() => {
    if (foodDrinkSlides.length <= 1) return;

    const timer = setInterval(() => {
      setFoodDrinkSlideIndex((prev) =>
        prev === foodDrinkSlides.length - 1 ? 0 : prev + 1
      );
    }, 2400);

    return () => clearInterval(timer);
  }, [foodDrinkSlides.length]);

  const cards = [
    {
      title: "Food & Drinks",
      desc: "Mocktails, momos, sausages, roasted chicken & more",
      img: foodDrinkSlides[foodDrinkSlideIndex] || "/home/mocktails.png",
      link: "/offer",
    },
    {
      title: "Air Hockey",
      desc: "Fast-paced 1v1 action",
      img: "/home/air-hockey.png",
      link: "/air-hockey",
    },
    {
      title: "Foosball",
      desc: "Fun 2v2 battles",
      img: "/home/foosball.jpg",
      link: "/foosball",
    },
    {
      title: "Massage Chair",
      desc: "Relax between games",
      img: "/home/massagechair.png",
      link: "/massage-chair",
    },
  ];

  useEffect(() => {
    foodDrinkSlides.forEach((src) => {
      if (!src) return;
      const img = new Image();
      img.src = src;
    });
  }, [foodDrinkSlides]);

  return (
    <>
      <div className="card">
        <h2 style={{ marginBottom: 6 }}>The Q Lounge - Beyond the Tables</h2>
        <div className="muted" style={{ marginBottom: 12 }}>
          More than just snooker — food, fun, comfort and the full Q Club experience
        </div>

        <div className="bt-scroll">
          {cards.map((c) => (
            <button
              key={c.title}
              type="button"
              className="bt-card"
              onClick={() => (c.link ? navigate(c.link) : setActiveImage(c))}
            >
              <img src={c.img} alt={c.title} />
              <div className="bt-overlay">
                <h3>{c.title}</h3>
                <p>{c.desc}</p>
                <span className="btn primary">
                  {c.title === "The Q Lounge"
                    ? "Open Lounge Menu"
                    : c.title === "Air Hockey"
                    ? "Play Air Hockey"
                    : c.title === "Foosball"
                    ? "Play Foosball"
                    : c.title === "Massage Chair"
                    ? "Relax Now"
                    : "Eat,Compete,Repeat"}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {activeImage ? (
        <div className="bt-modal" onClick={() => setActiveImage(null)}>
          <div
            className="bt-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="bt-close"
              onClick={() => setActiveImage(null)}
            >
              ×
            </button>

            <img
              src={activeImage.img}
              alt={activeImage.title}
              className="bt-modal-img"
            />

            <div className="bt-modal-info">
              <h3>{activeImage.title}</h3>
              <div className="muted">{activeImage.desc}</div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}